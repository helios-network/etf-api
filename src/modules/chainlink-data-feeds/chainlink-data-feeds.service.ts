import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from 'src/infrastructure/cache/cache.service';
import { ChainlinkDataFeed, ChainlinkDataFeedDocument } from 'src/models';

const ETHEREUM_CHAIN_ID = 1;
const ARBITRUM_CHAIN_ID = 42161;

const ETHEREUM_FEEDS_URL =
  'https://reference-data-directory.vercel.app/feeds-mainnet.json';
const ARBITRUM_FEEDS_URL =
  'https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-arbitrum-1.json';

interface ChainlinkFeed {
  compareOffchain: string;
  contractAddress: string;
  contractType: string;
  contractVersion: number;
  decimalPlaces: number | null;
  ens: string | null;
  formatDecimalPlaces: number | null;
  healthPrice: string;
  history: boolean | null;
  multiply: string;
  name: string;
  pair: string[];
  path: string;
  proxyAddress: string | null;
  threshold: number;
  valuePrefix: string;
  assetName: string;
  feedCategory: string;
  feedType: string;
  docs: any;
  decimals: number;
  feedId?: string;
  sourceChain: number;
  status: string;
  oracles: Array<{ operator: string }>;
  heartbeat?: number;
}

@Injectable()
export class ChainlinkDataFeedsService {
  private readonly logger = new Logger(ChainlinkDataFeedsService.name);

  constructor(
    @InjectModel(ChainlinkDataFeed.name)
    private chainlinkDataFeedModel: Model<ChainlinkDataFeedDocument>,
    private readonly cacheService: CacheService,
  ) {}

  async getAll(
    page: number,
    size: number,
    chainId?: number,
    feedCategory?: string,
    feedType?: string,
    status?: string,
  ) {
    // Validate pagination parameters
    if (page < 1) {
      throw new Error('Page must be greater than 0');
    }

    if (size < 1 || size > 100) {
      throw new Error('Size must be between 1 and 100');
    }

    // Build query filters
    const query: any = {};
    if (chainId !== undefined) {
      query.sourceChain = chainId;
    }
    if (feedCategory) {
      query.feedCategory = feedCategory;
    }
    if (feedType) {
      query.feedType = feedType;
    }
    if (status) {
      query.status = status;
    }

    // Calculate skip value
    const skip = (page - 1) * size;

    // Get total count for pagination metadata
    const total = await this.chainlinkDataFeedModel.countDocuments(query);

    // Fetch feeds with pagination
    const feeds = await this.chainlinkDataFeedModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(size)
      .lean()
      .exec();

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / size);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return {
      success: true,
      data: feeds,
      pagination: {
        page,
        size,
        total,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      },
    };
  }

  async reloadFeeds() {
    this.logger.log('[Chainlink Reload] Manual sync triggered via API');

    try {
      await this.syncChainlinkFeeds();

      // Invalidate cache after reload
      await this.cacheService.delPattern('feeds:*', { namespace: 'chainlink' });

      return {
        success: true,
        message: 'Chainlink feeds synchronization completed successfully',
      };
    } catch (error) {
      this.logger.error('[Chainlink Reload] Error during manual sync:', error);
      throw error;
    }
  }

  /**
   * Fetch feeds from the API
   */
  private async fetchFeeds(url: string): Promise<ChainlinkFeed[]> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch feeds: ${response.statusText}`);
      }
      return (await response.json()) as ChainlinkFeed[];
    } catch (error) {
      this.logger.error(`Error fetching feeds from ${url}:`, error);
      throw error;
    }
  }

  /**
   * Process and save feeds for a specific chain
   */
  private async processFeedsForChain(
    chainId: number,
    url: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `[Chainlink Sync] Starting sync for chain ${chainId} from ${url}`,
      );

      const feeds = await this.fetchFeeds(url);
      this.logger.log(
        `[Chainlink Sync] Fetched ${feeds.length} feeds for chain ${chainId}`,
      );

      let addedCount = 0;
      let skippedCount = 0;

      for (const feed of feeds) {
        try {
          if (!feed.proxyAddress) {
            continue;
          }

          // Check if feed already exists
          const existingFeed = await this.chainlinkDataFeedModel.findOne({
            proxyAddress: feed.proxyAddress,
          });

          if (existingFeed) {
            // Update existing feed
            await this.chainlinkDataFeedModel.updateOne(
              { proxyAddress: feed.proxyAddress },
              {
                $set: {
                  compareOffchain: feed.compareOffchain || '',
                  contractAddress: feed.contractAddress || '',
                  contractType: feed.contractType || '',
                  contractVersion: feed.contractVersion ?? 0,
                  decimalPlaces: feed.decimalPlaces,
                  ens: feed.ens,
                  formatDecimalPlaces: feed.formatDecimalPlaces,
                  history: feed.history,
                  multiply: feed.multiply || '',
                  name: feed.name || '',
                  pair: feed.pair || [],
                  path: feed.path || '',
                  proxyAddress: feed.proxyAddress,
                  threshold: feed.threshold ?? 0,
                  valuePrefix: feed.valuePrefix || '',
                  assetName: feed.assetName || '',
                  feedCategory: feed.feedCategory || '',
                  feedType: feed.feedType || '',
                  docs: feed.docs || {},
                  decimals: feed.decimals ?? 0,
                  sourceChain: feed.sourceChain || chainId,
                  status: feed.status || '',
                  oracles: feed.oracles || [],
                  heartbeat: feed.heartbeat,
                },
              },
            );
            skippedCount++;
          } else {
            // Insert new feed
            await this.chainlinkDataFeedModel.create({
              compareOffchain: feed.compareOffchain || '',
              contractAddress: feed.contractAddress || '',
              contractType: feed.contractType || '',
              contractVersion: feed.contractVersion ?? 0,
              decimalPlaces: feed.decimalPlaces,
              ens: feed.ens,
              formatDecimalPlaces: feed.formatDecimalPlaces,
              healthPrice: feed.healthPrice || '',
              history: feed.history,
              multiply: feed.multiply || '',
              name: feed.name || '',
              pair: feed.pair || [],
              path: feed.path || '',
              proxyAddress: feed.proxyAddress,
              threshold: feed.threshold ?? 0,
              valuePrefix: feed.valuePrefix || '',
              assetName: feed.assetName || '',
              feedCategory: feed.feedCategory || '',
              feedType: feed.feedType || '',
              docs: feed.docs || {},
              decimals: feed.decimals ?? 0,
              feedId: feed.feedId || null,
              sourceChain: feed.sourceChain || chainId,
              status: feed.status || '',
              oracles: feed.oracles || [],
              heartbeat: feed.heartbeat,
            });
            addedCount++;
          }
        } catch (error) {
          const identifier =
            feed.feedId || `${feed.path}-${feed.sourceChain || chainId}`;
          this.logger.error(
            `[Chainlink Sync] Error processing feed ${feed.name} (${identifier}):`,
            error,
          );
          skippedCount++;
        }
      }

      this.logger.log(
        `[Chainlink Sync] Chain ${chainId} sync completed: ${addedCount} added, ${skippedCount} skipped/updated`,
      );
    } catch (error) {
      this.logger.error(
        `[Chainlink Sync] Error processing feeds for chain ${chainId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Main function to sync all Chainlink feeds
   */
  async syncChainlinkFeeds(): Promise<void> {
    this.logger.log('[Chainlink Sync] Starting daily sync of Chainlink feeds');

    try {
      // Process Ethereum feeds
      await this.processFeedsForChain(ETHEREUM_CHAIN_ID, ETHEREUM_FEEDS_URL);

      // Process Arbitrum feeds
      await this.processFeedsForChain(ARBITRUM_CHAIN_ID, ARBITRUM_FEEDS_URL);

      this.logger.log('[Chainlink Sync] Daily sync completed successfully');
    } catch (error) {
      this.logger.error('[Chainlink Sync] Error during daily sync:', error);
      throw error;
    }
  }
}
