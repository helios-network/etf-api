import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { WalletHolding, WalletHoldingDocument } from '../../models/wallet-holding.schema';
import { ETF, ETFDocument } from '../../models/etf.schema';
import { WalletHoldingUtilsService } from '../../services/wallet-holding-utils.service';
import { TRANSACTION_POINTS } from '../../constants/transaction-points';

@Injectable()
export class LeaderBoardService {
  private readonly logger = new Logger(LeaderBoardService.name);

  constructor(
    @InjectModel(WalletHolding.name)
    private walletHoldingModel: Model<WalletHoldingDocument>,
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
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

  /**
   * Calculate volume from deposits if volumeTradedUSD is 0 or missing
   * Volume = sum of absolute values of all deposit amountUSD
   */
  private async calculateVolumeFromDeposits(
    deposits: Array<{
      chain: number;
      symbol: string;
      decimals?: number;
      etfVaultAddress?: string;
      etfTokenAddress?: string;
      amount: string;
      amountUSD?: number;
    }>,
  ): Promise<number> {
    if (!deposits || deposits.length === 0) {
      return 0;
    }

    let totalVolume = 0;

    // First, try to use amountUSD from deposits (if available and non-zero)
    const depositsWithAmountUSD = deposits.filter(
      (dep) => dep.amountUSD != null && dep.amountUSD !== 0,
    );

    if (depositsWithAmountUSD.length > 0) {
      // Sum absolute values of amountUSD
      totalVolume = depositsWithAmountUSD.reduce(
        (sum, dep) => sum + Math.abs(dep.amountUSD || 0),
        0,
      );
    }

    // If we still don't have volume, calculate from current ETF prices
    if (totalVolume === 0) {
      for (const deposit of deposits) {
        const sharesAmount = BigInt(deposit.amount?.toString() ?? '0');
        if (sharesAmount === 0n) {
          continue;
        }

        const vaultAddress = deposit.etfVaultAddress;
        if (!vaultAddress) {
          continue;
        }

        try {
          const etf = await this.etfModel.findOne({ vault: vaultAddress });
          if (!etf || !etf.sharePrice || etf.sharePrice <= 0) {
            continue;
          }

          const depositDecimals = deposit.decimals ?? etf.shareDecimals ?? 18;
          const sharesInHumanReadable =
            Number(sharesAmount) / Math.pow(10, depositDecimals);
          const depositValueUSD = sharesInHumanReadable * etf.sharePrice;
          totalVolume += Math.abs(depositValueUSD);
        } catch (error) {
          this.logger.warn(
            `Error calculating volume for deposit ${vaultAddress}:`,
            error,
          );
        }
      }
    }

    return totalVolume;
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
    const orderField = order || 'desc';

    // Build cache key with all parameters that influence the result
    const cacheKey = `${pageNum}:${limitNum}:${sortByField}:${orderField}`;

    // Use cache-aside pattern with 10 minutes TTL
    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        return await this.computeLeaderBoard(pageNum, limitNum, sortByField, orderField);
      },
      {
        namespace: 'leaderboard',
        ttl: 600, // 10 minutes
      },
    );
  }

  /**
   * Compute leaderboard data (extracted for caching)
   */
  private async computeLeaderBoard(
    pageNum: number,
    limitNum: number,
    sortByField: string,
    orderField: 'asc' | 'desc',
  ) {
    const orderNum = orderField === 'asc' ? 1 : -1;

    // Use cursor to process wallets in batches to avoid loading all in memory
    // Process in batches of 1000 to balance memory usage and performance
    const BATCH_SIZE = 1000;
    const entries: Array<{
      rank: number;
      address: string;
      feesGenerated: bigint;
      volumeTradedUSD: number;
      transactionsPerformed: number;
      tvl: number;
      avgTransactionSize: number;
      pointsPerTransaction: bigint;
      lastActivity: Date | null;
      transactionCounts: {
        createEtf: number;
        deposit: number;
        redeem: number;
        rebalance: number;
      };
      pointsByType: {
        createEtf: number;
        deposit: number;
        redeem: number;
        rebalance: number;
      };
      totalPoints: number;
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
            a.totalPoints > b.totalPoints
              ? 1
              : a.totalPoints < b.totalPoints
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
    // Ensure all numeric values are valid and properly formatted
    const formattedEntries = paginatedEntries.map((entry) => {
      // Ensure volumeTradedUSD is always a valid number string
      const volumeTradedUSD = 
        entry.volumeTradedUSD != null && 
        !isNaN(entry.volumeTradedUSD) 
          ? entry.volumeTradedUSD.toString() 
          : '0';
      
      // Ensure tvl is always a valid number
      const tvl = 
        entry.tvl != null && 
        !isNaN(entry.tvl) 
          ? entry.tvl 
          : 0;
      
      // Ensure avgTransactionSize is always a valid number string
      const avgTransactionSize = 
        entry.avgTransactionSize != null && 
        !isNaN(entry.avgTransactionSize) 
          ? entry.avgTransactionSize.toString() 
          : '0';

      return {
        rank: entry.rank,
        address: entry.address,
        feesGenerated: entry.feesGenerated.toString(),
        volumeTradedUSD,
        transactionsPerformed: entry.transactionsPerformed || 0,
        tvl,
        avgTransactionSize,
        pointsPerTransaction: entry.pointsPerTransaction.toString(),
        lastActivity: entry.lastActivity ? entry.lastActivity.toISOString() : null,
        transactionCounts: entry.transactionCounts,
        pointsByType: entry.pointsByType,
        totalPoints: entry.totalPoints,
      };
    });

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
      feesGenerated: bigint;
      volumeTradedUSD: number;
      transactionsPerformed: number;
      tvl: number;
      avgTransactionSize: number;
      pointsPerTransaction: bigint;
      lastActivity: Date | null;
      transactionCounts: {
        createEtf: number;
        deposit: number;
        redeem: number;
        rebalance: number;
      };
      pointsByType: {
        createEtf: number;
        deposit: number;
        redeem: number;
        rebalance: number;
      };
      totalPoints: number;
    }>
  > {
    // Calculate leaderboard entries with TVL for this batch
    const entriesPromises = walletHoldings.map(async (holding) => {
      // Ensure volumeTradedUSD is always a valid number
      let volumeTradedUSD = 
        holding.volumeTradedUSD != null && 
        !isNaN(Number(holding.volumeTradedUSD)) && 
        Number(holding.volumeTradedUSD) > 0
          ? Number(holding.volumeTradedUSD) 
          : 0;
      
      // If volume is 0, try to calculate it from deposits
      if (volumeTradedUSD === 0 && holding.deposits && holding.deposits.length > 0) {
        try {
          volumeTradedUSD = await this.calculateVolumeFromDeposits(holding.deposits);
          // Optionally update the wallet in background (don't await)
          if (volumeTradedUSD > 0) {
            this.walletHoldingModel
              .updateOne(
                { _id: holding._id },
                { $set: { volumeTradedUSD } },
              )
              .catch((err) =>
                this.logger.error(
                  `Error updating volumeTradedUSD for wallet ${holding.wallet}:`,
                  err,
                ),
              );
          }
        } catch (error) {
          this.logger.error(
            `Error calculating volume for wallet ${holding.wallet}:`,
            error,
          );
        }
      }
      
      // Get transaction counts
      const createEtfCount = holding.createEtfCount ?? 0;
      const depositCount = holding.depositCount ?? 0;
      const redeemCount = holding.redeemCount ?? 0;
      const rebalanceCount = holding.rebalanceCount ?? 0;
      
      const transactionsPerformed = createEtfCount + depositCount + redeemCount + rebalanceCount;

      // Calculate points by type
      const pointsByType = {
        createEtf: createEtfCount * TRANSACTION_POINTS.CREATE_ETF,
        deposit: depositCount * TRANSACTION_POINTS.DEPOSIT,
        redeem: redeemCount * TRANSACTION_POINTS.REDEEM,
        rebalance: rebalanceCount * TRANSACTION_POINTS.REBALANCE,
      };

      const totalPoints = pointsByType.createEtf + pointsByType.deposit + pointsByType.redeem + pointsByType.rebalance;

      // Calculate average transaction size
      const avgTransactionSize =
        transactionsPerformed > 0 ? volumeTradedUSD / transactionsPerformed : 0;

      // Calculate points per transaction
      const pointsPerTransaction =
        transactionsPerformed > 0
          ? BigInt(totalPoints) / BigInt(transactionsPerformed)
          : 0n;

      // Calculate TVL if not set or if deposits exist
      let tvl = 
        holding.tvl != null && !isNaN(Number(holding.tvl))
          ? Number(holding.tvl)
          : 0;
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
        feesGenerated: 0n, // TODO: Calculate fees if needed
        volumeTradedUSD,
        transactionsPerformed,
        tvl,
        avgTransactionSize,
        pointsPerTransaction,
        lastActivity: holding.updatedAt || null,
        transactionCounts: {
          createEtf: createEtfCount,
          deposit: depositCount,
          redeem: redeemCount,
          rebalance: rebalanceCount,
        },
        pointsByType,
        totalPoints,
      };
    });

    return await Promise.all(entriesPromises);
  }
}
