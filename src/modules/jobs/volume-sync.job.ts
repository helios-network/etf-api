import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  WalletHolding,
  WalletHoldingDocument,
  Event,
  EventDocument,
  ETF,
  ETFDocument,
} from 'src/models';
import { TRANSACTION_POINTS } from 'src/constants/transaction-points';
import { normalizeEthAddress } from 'src/common/utils/eip55';
import { EtfVolumeService } from 'src/services';

const BATCH_SIZE = 100; // Number of wallets to process per batch

@Injectable()
export class VolumeSyncJob {
  private readonly logger = new Logger(VolumeSyncJob.name);

  constructor(
    @InjectModel(WalletHolding.name)
    private walletHoldingModel: Model<WalletHoldingDocument>,
    @InjectModel(Event.name)
    private eventModel: Model<EventDocument>,
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
    private readonly etfVolumeService: EtfVolumeService,
  ) {}

  /**
   * Resynchronize volumeTradedUSD for all wallets from historical events
   */
  async resyncVolumeTradedUSD(): Promise<void> {
    this.logger.log('Starting volumeTradedUSD resynchronization...');

    let processed = 0;
    let updated = 0;
    let errors = 0;

    // Process wallets in batches
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const wallets = await this.walletHoldingModel
        .find()
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean()
        .exec();

      if (wallets.length === 0) {
        break;
      }

      for (const wallet of wallets) {
        try {
          const newVolume = await this.calculateVolumeFromEvents(wallet.wallet);

          if (newVolume !== wallet.volumeTradedUSD) {
            await this.walletHoldingModel.updateOne(
              { _id: wallet._id },
              { $set: { volumeTradedUSD: newVolume } },
            );
            updated++;
            this.logger.debug(
              `Updated wallet ${wallet.wallet}: ${wallet.volumeTradedUSD} -> ${newVolume}`,
            );
          }
          processed++;
        } catch (error) {
          errors++;
          this.logger.error(`Error processing wallet ${wallet.wallet}:`, error);
        }
      }

      skip += BATCH_SIZE;
      hasMore = wallets.length === BATCH_SIZE;

      this.logger.log(
        `Processed ${processed} wallets, updated ${updated}, errors ${errors}`,
      );
    }

    this.logger.log(
      `Volume resynchronization completed. Processed: ${processed}, Updated: ${updated}, Errors: ${errors}`,
    );
  }

  /**
   * Calculate volumeTradedUSD from historical Deposit and Redeem events
   */
  private async calculateVolumeFromEvents(
    walletAddress: string,
  ): Promise<number> {
    const normalizedWalletAddress = normalizeEthAddress(walletAddress);

    // Get all Deposit and Redeem events for this wallet
    const depositEvents = await this.eventModel
      .find({
        type: 'Deposit',
        user: normalizedWalletAddress,
      })
      .sort({ blockNumber: 1, nonce: 1 })
      .lean()
      .exec();

    const redeemEvents = await this.eventModel
      .find({
        type: 'Redeem',
        user: normalizedWalletAddress,
      })
      .sort({ blockNumber: 1, nonce: 1 })
      .lean()
      .exec();

    let totalVolume = 0;

    // Process deposit events
    for (const event of depositEvents) {
      if (!event.vault || !event.sharesOut) {
        continue;
      }

      try {
        const normalizedVault = event.vault
          ? normalizeEthAddress(event.vault)
          : undefined;
        if (!normalizedVault) continue;
        const volume = await this.calculateEventVolume(
          normalizedVault,
          event.chain,
          BigInt(event.sharesOut),
          event.blockNumber,
        );
        totalVolume += volume;
      } catch (error) {
        this.logger.warn(
          `Error calculating volume for deposit event ${event._id}:`,
          error,
        );
      }
    }

    // Process redeem events (add absolute value for volume calculation)
    for (const event of redeemEvents) {
      if (!event.vault || !event.sharesIn) {
        continue;
      }

      try {
        const normalizedVault = normalizeEthAddress(event.vault);
        const volume = await this.calculateEventVolume(
          normalizedVault,
          event.chain,
          BigInt(event.sharesIn),
          event.blockNumber,
        );
        totalVolume += volume; // Add absolute value for volume
      } catch (error) {
        this.logger.warn(
          `Error calculating volume for redeem event ${event._id}:`,
          error,
        );
      }
    }

    return Number(totalVolume.toFixed(2));
  }

  /**
   * Calculate volume in USD for a specific event
   * Uses the ETF's sharePrice at the time of the event (or current if not available)
   */
  private async calculateEventVolume(
    vault: string,
    chain: number,
    shares: bigint,
    blockNumber: string,
  ): Promise<number> {
    const normalizedVault = normalizeEthAddress(vault);
    // Get ETF
    const etf = await this.etfModel
      .findOne({ vault: normalizedVault, chain })
      .lean()
      .exec();

    if (!etf) {
      this.logger.warn(`ETF not found for vault ${vault} on chain ${chain}`);
      return 0;
    }

    // Use current sharePrice (we don't have historical prices)
    // In a perfect world, we would fetch historical prices, but for now we use current
    const sharePrice = etf.sharePrice;
    if (!sharePrice || sharePrice <= 0) {
      return 0;
    }

    const shareDecimals = etf.shareDecimals ?? 18;
    const sharesInHumanReadable = Number(shares) / Math.pow(10, shareDecimals);
    const volumeUSD = sharePrice * sharesInHumanReadable;

    return volumeUSD;
  }

  /**
   * Resynchronize volume for a specific wallet (useful for testing or individual fixes)
   */
  async resyncVolumeForWallet(walletAddress: string): Promise<number> {
    this.logger.log(`Resyncing volume for wallet ${walletAddress}...`);

    const normalizedWalletAddress = normalizeEthAddress(walletAddress);
    const newVolume = await this.calculateVolumeFromEvents(
      normalizedWalletAddress,
    );

    await this.walletHoldingModel.updateOne(
      { wallet: normalizedWalletAddress },
      { $set: { volumeTradedUSD: newVolume } },
    );

    this.logger.log(`Updated wallet ${walletAddress} volume to ${newVolume}`);

    return newVolume;
  }

  /**
   * Calculate transaction counts from historical events
   */
  private async calculateTransactionCountsFromEvents(
    walletAddress: string,
  ): Promise<{
    createEtfCount: number;
    depositCount: number;
    redeemCount: number;
    rebalanceCount: number;
  }> {
    const normalizedWalletAddress = normalizeEthAddress(walletAddress);

    // Count Deposit events
    const depositCount = await this.eventModel
      .countDocuments({
        type: 'Deposit',
        user: normalizedWalletAddress,
      })
      .exec();

    // Count Redeem events
    const redeemCount = await this.eventModel
      .countDocuments({
        type: 'Redeem',
        user: normalizedWalletAddress,
      })
      .exec();

    // Count ETFCreated events where user matches (if user field is set)
    // Note: ETFCreated events might not always have a user field
    const createEtfCount = await this.eventModel
      .countDocuments({
        type: 'ETFCreated',
        user: normalizedWalletAddress,
      })
      .exec();

    // For Rebalance events, count how many rebalances occurred in vaults
    // where this wallet has deposits
    const walletHolding = await this.walletHoldingModel
      .findOne({
        wallet: normalizedWalletAddress,
      })
      .lean()
      .exec();

    let rebalanceCount = 0;
    if (
      walletHolding &&
      walletHolding.deposits &&
      walletHolding.deposits.length > 0
    ) {
      // Get unique vault addresses from deposits
      const vaultAddresses = [
        ...new Set(
          walletHolding.deposits
            .map((dep) => dep.etfVaultAddress)
            .filter((vault): vault is string => !!vault),
        ),
      ];

      if (vaultAddresses.length > 0) {
        // Normalize vault addresses
        const normalizedVaultAddresses = vaultAddresses.map((v) =>
          normalizeEthAddress(v),
        );
        // Count Rebalance events for these vaults
        rebalanceCount = await this.eventModel
          .countDocuments({
            type: 'Rebalance',
            vault: { $in: normalizedVaultAddresses },
          })
          .exec();
      }
    }

    return {
      createEtfCount,
      depositCount,
      redeemCount,
      rebalanceCount,
    };
  }

  /**
   * Resynchronize transaction counts for all wallets from historical events
   */
  async resyncTransactionCounts(): Promise<void> {
    this.logger.log('Starting transaction counts resynchronization...');

    let processed = 0;
    let updated = 0;
    let errors = 0;

    // Process wallets in batches
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const wallets = await this.walletHoldingModel
        .find()
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean()
        .exec();

      if (wallets.length === 0) {
        break;
      }

      for (const wallet of wallets) {
        try {
          const counts = await this.calculateTransactionCountsFromEvents(
            wallet.wallet,
          );

          const hasChanges =
            counts.createEtfCount !== (wallet.createEtfCount ?? 0) ||
            counts.depositCount !== (wallet.depositCount ?? 0) ||
            counts.redeemCount !== (wallet.redeemCount ?? 0) ||
            counts.rebalanceCount !== (wallet.rebalanceCount ?? 0);

          if (hasChanges) {
            await this.walletHoldingModel.updateOne(
              { _id: wallet._id },
              {
                $set: {
                  createEtfCount: counts.createEtfCount,
                  depositCount: counts.depositCount,
                  redeemCount: counts.redeemCount,
                  rebalanceCount: counts.rebalanceCount,
                },
              },
            );
            updated++;
            this.logger.debug(
              `Updated wallet ${wallet.wallet} transaction counts: createEtf=${counts.createEtfCount}, deposit=${counts.depositCount}, redeem=${counts.redeemCount}, rebalance=${counts.rebalanceCount}`,
            );
          }
          processed++;
        } catch (error) {
          errors++;
          this.logger.error(`Error processing wallet ${wallet.wallet}:`, error);
        }
      }

      skip += BATCH_SIZE;
      hasMore = wallets.length === BATCH_SIZE;

      this.logger.log(
        `Processed ${processed} wallets, updated ${updated}, errors ${errors}`,
      );
    }

    this.logger.log(
      `Transaction counts resynchronization completed. Processed: ${processed}, Updated: ${updated}, Errors: ${errors}`,
    );
  }

  /**
   * Resynchronize transaction counts for a specific wallet
   */
  async resyncTransactionCountsForWallet(walletAddress: string): Promise<{
    createEtfCount: number;
    depositCount: number;
    redeemCount: number;
    rebalanceCount: number;
  }> {
    this.logger.log(
      `Resyncing transaction counts for wallet ${walletAddress}...`,
    );

    const normalizedWalletAddress = normalizeEthAddress(walletAddress);
    const counts = await this.calculateTransactionCountsFromEvents(
      normalizedWalletAddress,
    );

    await this.walletHoldingModel.updateOne(
      { wallet: normalizedWalletAddress },
      {
        $set: {
          createEtfCount: counts.createEtfCount,
          depositCount: counts.depositCount,
          redeemCount: counts.redeemCount,
          rebalanceCount: counts.rebalanceCount,
        },
      },
    );

    this.logger.log(
      `Updated wallet ${walletAddress} transaction counts: createEtf=${counts.createEtfCount}, deposit=${counts.depositCount}, redeem=${counts.redeemCount}, rebalance=${counts.rebalanceCount}`,
    );

    return counts;
  }

  /**
   * Calculate points by type from transaction counts
   */
  private calculatePointsByType(counts: {
    createEtfCount: number;
    depositCount: number;
    redeemCount: number;
    rebalanceCount: number;
  }): {
    createEtf: number;
    deposit: number;
    redeem: number;
    rebalance: number;
  } {
    return {
      createEtf: counts.createEtfCount * TRANSACTION_POINTS.CREATE_ETF,
      deposit: counts.depositCount * TRANSACTION_POINTS.DEPOSIT,
      redeem: counts.redeemCount * TRANSACTION_POINTS.REDEEM,
      rebalance: counts.rebalanceCount * TRANSACTION_POINTS.REBALANCE,
    };
  }

  /**
   * Resynchronize transaction counts and points for all wallets
   * This is a convenience method that does both
   */
  async resyncTransactionCountsAndPoints(): Promise<void> {
    this.logger.log(
      'Starting transaction counts and points resynchronization...',
    );

    // First resync transaction counts
    await this.resyncTransactionCounts();

    // Points are calculated from transaction counts in the leaderboard service
    // so we don't need to store them separately, they're computed on the fly
    this.logger.log(
      'Transaction counts and points resynchronization completed.',
    );
  }

  /**
   * Resynchronize transaction counts and points for a specific wallet
   */
  async resyncTransactionCountsAndPointsForWallet(
    walletAddress: string,
  ): Promise<{
    transactionCounts: {
      createEtfCount: number;
      depositCount: number;
      redeemCount: number;
      rebalanceCount: number;
    };
    pointsByType: {
      createEtf: number;
      deposit: number;
      redeem: number;
      rebalance: number;
    };
  }> {
    const counts = await this.resyncTransactionCountsForWallet(walletAddress);
    const pointsByType = this.calculatePointsByType(counts);

    return {
      transactionCounts: counts,
      pointsByType,
    };
  }

  /**
   * Cleanup daily volumes and recalculate dailyVolumeUSD for all ETFs
   * Runs every hour to ensure consistency
   */
  @Cron('0 0 * * * *') // Every hour at minute 0
  async cleanupDailyVolumes(): Promise<void> {
    this.logger.log('Starting daily volumes cleanup...');
    try {
      await this.etfVolumeService.cleanupAndRecalculateAll();
      this.logger.log('Daily volumes cleanup completed successfully');
    } catch (error) {
      this.logger.error('Error in daily volumes cleanup:', error);
    }
  }
}
