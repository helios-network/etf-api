import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { WalletHolding, WalletHoldingDocument } from '../../models/wallet-holding.schema';
import { WalletHoldingUtilsService } from '../../services/wallet-holding-utils.service';

@Injectable()
export class LeaderBoardService {
  private readonly logger = new Logger(LeaderBoardService.name);

  constructor(
    @InjectModel(WalletHolding.name)
    private walletHoldingModel: Model<WalletHoldingDocument>,
    private readonly cacheService: CacheService,
    private readonly walletHoldingUtils: WalletHoldingUtilsService,
  ) {}

  /**
   * Calculate total points accrued from rewards
   */
  private calculateTotalPoints(rewards: any[]): bigint {
    return rewards.reduce((total, reward) => {
      return total + BigInt(reward.amount?.toString() ?? '0');
    }, 0n);
  }

  async getLeaderBoard(
    page: number,
    limit: number,
    sortBy: string,
    order: 'asc' | 'desc',
  ) {
    const pageNum = Math.max(1, page);
    const limitNum = Math.min(100, Math.max(1, limit));
    const sortByField = sortBy || 'points';
    const orderNum = order === 'asc' ? 1 : -1;

    // Use cursor to process wallets in batches to avoid loading all in memory
    // Process in batches of 1000 to balance memory usage and performance
    const BATCH_SIZE = 1000;
    const entries: Array<{
      rank: number;
      address: string;
      totalPointsAccrued: bigint;
      feesGenerated: bigint;
      volumeTradedUSD: number;
      transactionsPerformed: number;
      tvl: number;
      avgTransactionSize: number;
      pointsPerTransaction: bigint;
      lastActivity: Date | null;
    }> = [];

    // Process wallets in batches using cursor
    const cursor = this.walletHoldingModel.find().lean().cursor();
    let batch: any[] = [];

    for await (const holding of cursor) {
      batch.push(holding);

      // Process batch when it reaches BATCH_SIZE
      if (batch.length >= BATCH_SIZE) {
        const batchEntries = await this.processWalletBatch(batch);
        entries.push(...batchEntries);
        batch = [];
      }
    }

    // Process remaining wallets in the last batch
    if (batch.length > 0) {
      const batchEntries = await this.processWalletBatch(batch);
      entries.push(...batchEntries);
    }

    // Sort entries based on sortBy parameter
    entries.sort((a, b) => {
      let comparison = 0;

      switch (sortByField) {
        case 'volume':
          comparison =
            a.volumeTradedUSD > b.volumeTradedUSD
              ? 1
              : a.volumeTradedUSD < b.volumeTradedUSD
                ? -1
                : 0;
          break;
        case 'transactions':
          comparison = a.transactionsPerformed - b.transactionsPerformed;
          break;
        case 'points':
        default:
          comparison =
            a.totalPointsAccrued > b.totalPointsAccrued
              ? 1
              : a.totalPointsAccrued < b.totalPointsAccrued
                ? -1
                : 0;
          break;
      }

      return comparison * orderNum;
    });

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    // Calculate pagination
    const total = entries.length;
    const totalPages = Math.ceil(total / limitNum);
    const skip = (pageNum - 1) * limitNum;
    const paginatedEntries = entries.slice(skip, skip + limitNum);

    // Convert BigInt values to strings for JSON response
    const formattedEntries = paginatedEntries.map((entry) => ({
      rank: entry.rank,
      address: entry.address,
      totalPointsAccrued: entry.totalPointsAccrued.toString(),
      feesGenerated: entry.feesGenerated.toString(),
      volumeTradedUSD: entry.volumeTradedUSD.toString(),
      transactionsPerformed: entry.transactionsPerformed,
      tvl: entry.tvl,
      avgTransactionSize: entry.avgTransactionSize.toString(),
      pointsPerTransaction: entry.pointsPerTransaction.toString(),
      lastActivity: entry.lastActivity ? entry.lastActivity.toISOString() : null,
    }));

    return {
      success: true,
      data: formattedEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    };
  }

  /**
   * Process a batch of wallet holdings and calculate their leaderboard metrics
   */
  private async processWalletBatch(
    walletHoldings: any[],
  ): Promise<
    Array<{
      rank: number;
      address: string;
      totalPointsAccrued: bigint;
      feesGenerated: bigint;
      volumeTradedUSD: number;
      transactionsPerformed: number;
      tvl: number;
      avgTransactionSize: number;
      pointsPerTransaction: bigint;
      lastActivity: Date | null;
    }>
  > {
    // Calculate leaderboard entries with TVL for this batch
    const entriesPromises = walletHoldings.map(async (holding) => {
      const totalPointsAccrued = this.calculateTotalPoints(holding.rewards || []);
      const volumeTradedUSD = holding.volumeTradedUSD || 0;
      const transactionsPerformed = holding.transactionsPerformed || 0;

      // Calculate average transaction size
      const avgTransactionSize =
        transactionsPerformed > 0 ? volumeTradedUSD / transactionsPerformed : 0;

      // Calculate points per transaction
      const pointsPerTransaction =
        transactionsPerformed > 0
          ? totalPointsAccrued / BigInt(transactionsPerformed)
          : 0n;

      // Calculate TVL if not set or if deposits exist
      let tvl = holding.tvl || 0;
      if ((!tvl || tvl === 0) && holding.deposits && holding.deposits.length > 0) {
        try {
          // Calculate TVL on the fly (function now fetches ETFs from DB using deposit vault addresses)
          tvl = await this.walletHoldingUtils.calculateWalletTVL(
            holding.deposits as any,
          );
          // Optionally update the wallet in background (don't await)
          this.walletHoldingModel
            .updateOne({ _id: holding._id }, { $set: { tvl } })
            .catch((err) =>
              this.logger.error(`Error updating TVL for wallet ${holding.wallet}:`, err),
            );
        } catch (error) {
          this.logger.error(`Error calculating TVL for wallet ${holding.wallet}:`, error);
        }
      }

      return {
        rank: 0, // Will be set after sorting
        address: holding.wallet,
        totalPointsAccrued,
        feesGenerated: 0n, // TODO: Calculate fees if needed
        volumeTradedUSD,
        transactionsPerformed,
        tvl,
        avgTransactionSize,
        pointsPerTransaction,
        lastActivity: holding.updatedAt || null,
      };
    });

    return await Promise.all(entriesPromises);
  }
}
