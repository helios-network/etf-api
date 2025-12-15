import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MasterOnly } from '../../common/decorators/master-only.decorator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ChainlinkDataFeed,
  ChainlinkDataFeedDocument,
} from '../../models/chainlink-data-feed.schema';

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
@MasterOnly()
export class ChainlinkSyncJob {
  private readonly logger = new Logger(ChainlinkSyncJob.name);

  constructor(
    @InjectModel(ChainlinkDataFeed.name)
    private chainlinkDataFeedModel: Model<ChainlinkDataFeedDocument>,
  ) {}

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

  private async processFeedsForChain(
    chainId: number,
    url: string,
  ): Promise<void> {
    try {
      this.logger.log(`Starting Chainlink sync for chain ${chainId}`);

      const feeds = await this.fetchFeeds(url);
      this.logger.debug(`Fetched ${feeds.length} feeds for chain ${chainId}`);

      let addedCount = 0;
      let skippedCount = 0;

      for (const feed of feeds) {
        try {
          if (!feed.proxyAddress) {
            continue;
          }

          const existingFeed = await this.chainlinkDataFeedModel.findOne({
            proxyAddress: feed.proxyAddress,
          });

          if (existingFeed) {
            const updateQuery = { proxyAddress: feed.proxyAddress };

            await this.chainlinkDataFeedModel.updateOne(updateQuery, {
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
            });
            skippedCount++;
          } else {
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
          this.logger.warn(
            `Error processing feed ${feed.name} (${identifier}):`,
            error,
          );
          skippedCount++;
        }
      }

      this.logger.log(
        `Chainlink sync completed for chain ${chainId}: ${addedCount} added, ${skippedCount} updated`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing feeds for chain ${chainId}:`,
        error,
      );
    }
  }

  @Cron('0 0 0 * * *')
  async syncChainlinkFeeds(): Promise<void> {
    this.logger.log('Starting daily Chainlink feeds sync');

    try {
      await this.processFeedsForChain(ETHEREUM_CHAIN_ID, ETHEREUM_FEEDS_URL);
      await this.processFeedsForChain(ARBITRUM_CHAIN_ID, ARBITRUM_FEEDS_URL);

      this.logger.log('Daily sync completed successfully');
    } catch (error) {
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (
          errorMessage.includes('mongodb') ||
          errorMessage.includes('connection') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('network')
        ) {
          this.logger.error(
            `MongoDB error in Chainlink sync job: ${error.message}`,
            error.stack,
          );
        } else {
          this.logger.error(
            `Error in Chainlink sync job: ${error.message}`,
            error.stack,
          );
        }
      } else {
        this.logger.error('Unknown error in Chainlink sync job:', error);
      }
    }
  }
}
