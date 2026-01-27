import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChainlinkDataFeed, ChainlinkDataFeedDocument } from 'src/models';
import { ChainlinkFeed } from 'src/types/etf-verify.types';

@Injectable()
export class ChainlinkResolverService {
  private readonly logger = new Logger(ChainlinkResolverService.name);

  constructor(
    @InjectModel(ChainlinkDataFeed.name)
    private chainlinkDataFeedModel: Model<ChainlinkDataFeedDocument>,
  ) {}

  /**
   * Resolve Chainlink feed for a token
   * Searches for TOKEN/USD feed using the path field (e.g., "usdc-usd", "wbtc-usd")
   */
  async resolveChainlinkFeed(
    tokenSymbol: string,
    chainId: number,
  ): Promise<ChainlinkFeed | null> {
    try {
      // Normalize token symbol to lowercase for path matching
      const normalizedSymbol = tokenSymbol.toLowerCase();

      // Search for feed with path matching "token-usd" or "token-usd" pattern
      // The path field contains minified symbols like "usdc-usd", "wbtc-usd"
      const feed = await this.chainlinkDataFeedModel.findOne({
        sourceChain: chainId,
        path: `${normalizedSymbol}-usd`,
        proxyAddress: { $ne: null },
        status: { $ne: 'deprecated' }, // Exclude deprecated feeds
      });

      if (!feed || !feed.proxyAddress) {
        return null;
      }

      return {
        proxyAddress: feed.proxyAddress,
        path: feed.path,
        pair: feed.pair,
        decimals: feed.decimals,
      };
    } catch (error) {
      this.logger.error(
        `Error resolving Chainlink feed for ${tokenSymbol}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Resolve Chainlink feed for USDC (deposit token)
   */
  async resolveUSDCFeed(chainId: number): Promise<ChainlinkFeed | null> {
    return this.resolveChainlinkFeed('usdc', chainId);
  }
}
