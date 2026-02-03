import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EtfVolume,
  EtfVolumeDocument,
  EtfPriceChart,
  EtfPriceChartDocument,
  ETF,
  ETFDocument,
} from 'src/models';
import { normalizeEthAddress } from 'src/common/utils/eip55';

@Injectable()
export class EtfVolumeService {
  private readonly logger = new Logger(EtfVolumeService.name);
  private readonly TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  constructor(
    @InjectModel(EtfVolume.name)
    private etfVolumeModel: Model<EtfVolumeDocument>,
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
    @InjectModel(EtfPriceChart.name)
    private etfPriceChartModel: Model<EtfPriceChartDocument>,
  ) {}

  /**
   * Add a volume entry and update dailyVolumeUSD on ETF
   * Cleans volumes older than 24h before adding the new one
   */
  async addVolume(
    vault: string,
    chain: number,
    usd: number,
    timestamp: number = Date.now(),
  ): Promise<number> {
    const normalizedVault = normalizeEthAddress(vault);
    const cutoffTime = timestamp - this.TWENTY_FOUR_HOURS_MS;

    // Find or create etf-volume document
    let etfVolume = await this.etfVolumeModel.findOne({
      vault: normalizedVault,
      chain,
    });

    if (!etfVolume) {
      etfVolume = await this.etfVolumeModel.create({
        vault: normalizedVault,
        chain,
        volumes: [],
      });
    }

    // Clean volumes older than 24h
    const filteredVolumes = etfVolume.volumes.filter(
      (v) => v.time >= cutoffTime,
    );

    // Add new volume
    filteredVolumes.push({ time: timestamp, usd });

    // Calculate total
    const totalVolume = filteredVolumes.reduce((sum, v) => sum + v.usd, 0);

    // Update etf-volume document
    await this.etfVolumeModel.updateOne(
      { _id: etfVolume._id },
      { $set: { volumes: filteredVolumes } },
    );

    // Update ETF dailyVolumeUSD
    await this.etfModel.updateOne(
      { vault: normalizedVault, chain },
      { $set: { dailyVolumeUSD: Number(totalVolume.toFixed(2)) } },
    );

    return Number(totalVolume.toFixed(2));
  }

  /**
   * Get daily volume for an ETF (cleans old volumes first)
   */
  async getDailyVolume(vault: string, chain: number): Promise<number> {
    const normalizedVault = normalizeEthAddress(vault);
    const cutoffTime = Date.now() - this.TWENTY_FOUR_HOURS_MS;

    const etfVolume = await this.etfVolumeModel.findOne({
      vault: normalizedVault,
      chain,
    });

    if (!etfVolume) {
      return 0;
    }

    // Clean volumes older than 24h
    const filteredVolumes = etfVolume.volumes.filter(
      (v) => v.time >= cutoffTime,
    );

    // Update document if volumes were cleaned
    if (filteredVolumes.length !== etfVolume.volumes.length) {
      await this.etfVolumeModel.updateOne(
        { _id: etfVolume._id },
        { $set: { volumes: filteredVolumes } },
      );
    }

    // Calculate and return total
    const totalVolume = filteredVolumes.reduce((sum, v) => sum + v.usd, 0);
    return Number(totalVolume.toFixed(2));
  }

  /**
   * Cleanup all etf-volumes and recalculate dailyVolumeUSD for all ETFs
   */
  async cleanupAndRecalculateAll(): Promise<void> {
    this.logger.log('Starting cleanup and recalculation of daily volumes...');

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const sixtyDaysMs = 60 * oneDayMs;
    // Keep at least 60 days of data for 30d change calculations
    const cutoffTime = now - sixtyDaysMs;
    let processed = 0;
    let updated = 0;

    // Process in batches
    const BATCH_SIZE = 100;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const etfVolumes = await this.etfVolumeModel
        .find()
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean()
        .exec();

      if (etfVolumes.length === 0) {
        break;
      }

      for (const etfVolume of etfVolumes) {
        try {
          const oneDayMs = 24 * 60 * 60 * 1000;
          const sevenDaysMs = 7 * oneDayMs;
          const thirtyDaysMs = 30 * oneDayMs;

          // Clean volumes older than 24h
          const filteredVolumes = etfVolume.volumes.filter(
            (v) => v.time >= now - this.TWENTY_FOUR_HOURS_MS,
          );

          // Calculate total (24h volume)
          const totalVolume = filteredVolumes.reduce(
            (sum, v) => sum + v.usd,
            0,
          );

          // Get current ETF price and price chart data for price change calculations
          const normalizedVault = normalizeEthAddress(etfVolume.vault);
          const etf = await this.etfModel.findOne({
            vault: normalizedVault,
            chain: etfVolume.chain,
          });

          const currentPrice = etf?.sharePrice || 0;

          // Get price chart data for historical prices
          const priceChart = await this.etfPriceChartModel.findOne({
            vaultAddress: normalizedVault,
          });

          // Calculate price change percentages
          let priceChange24h = 0;
          let priceChange7d = 0;
          let priceChange30d = 0;

          if (
            currentPrice > 0 &&
            priceChart &&
            priceChart.entries &&
            priceChart.entries.length > 0
          ) {
            const sortedEntries = [...priceChart.entries].sort(
              (a, b) => a.timestamp - b.timestamp,
            );

            // 24h Change: Compare current price vs price 24h ago
            const last24hStart = now - oneDayMs;
            const previous24hEntry = sortedEntries
              .filter(
                (e) =>
                  e.timestamp >= now - 2 * oneDayMs &&
                  e.timestamp < last24hStart,
              )
              .sort((a, b) => b.timestamp - a.timestamp)[0];

            if (previous24hEntry && previous24hEntry.sharePrice > 0) {
              priceChange24h =
                ((currentPrice - previous24hEntry.sharePrice) /
                  previous24hEntry.sharePrice) *
                100;
            }

            // 7d Change: Compare current price vs price 7d ago
            const last7dStart = now - sevenDaysMs;
            const previous7dEntry = sortedEntries
              .filter(
                (e) =>
                  e.timestamp >= now - 2 * sevenDaysMs &&
                  e.timestamp < last7dStart,
              )
              .sort((a, b) => b.timestamp - a.timestamp)[0];

            if (previous7dEntry && previous7dEntry.sharePrice > 0) {
              priceChange7d =
                ((currentPrice - previous7dEntry.sharePrice) /
                  previous7dEntry.sharePrice) *
                100;
            }

            // 30d Change: Compare current price vs price 30d ago
            const last30dStart = now - thirtyDaysMs;
            const previous30dEntry = sortedEntries
              .filter(
                (e) =>
                  e.timestamp >= now - 2 * thirtyDaysMs &&
                  e.timestamp < last30dStart,
              )
              .sort((a, b) => b.timestamp - a.timestamp)[0];

            if (previous30dEntry && previous30dEntry.sharePrice > 0) {
              priceChange30d =
                ((currentPrice - previous30dEntry.sharePrice) /
                  previous30dEntry.sharePrice) *
                100;
            }
          }

          // Update etf-volume document if volumes were cleaned
          if (filteredVolumes.length !== etfVolume.volumes.length) {
            await this.etfVolumeModel.updateOne(
              { _id: etfVolume._id },
              { $set: { volumes: filteredVolumes } },
            );
          }

          // Update ETF dailyVolumeUSD and price change percentages
          await this.etfModel.updateOne(
            { vault: etfVolume.vault, chain: etfVolume.chain },
            {
              $set: {
                dailyVolumeUSD: Number(totalVolume.toFixed(2)),
                priceChange24h: Number(priceChange24h.toFixed(2)),
                priceChange7d: Number(priceChange7d.toFixed(2)),
                priceChange30d: Number(priceChange30d.toFixed(2)),
              },
            },
          );

          updated++;
          processed++;
        } catch (error) {
          this.logger.error(
            `Error processing etf-volume ${etfVolume.vault} on chain ${etfVolume.chain}:`,
            error,
          );
          processed++;
        }
      }

      skip += BATCH_SIZE;
      hasMore = etfVolumes.length === BATCH_SIZE;
    }

    this.logger.log(
      `Cleanup completed. Processed: ${processed}, Updated: ${updated}`,
    );
  }

  /**
   * Recalculate daily volume for a specific ETF
   */
  async recalculateForVault(vault: string, chain: number): Promise<number> {
    const normalizedVault = normalizeEthAddress(vault);
    const dailyVolume = await this.getDailyVolume(normalizedVault, chain);

    // Update ETF
    await this.etfModel.updateOne(
      { vault: normalizedVault, chain },
      { $set: { dailyVolumeUSD: dailyVolume } },
    );

    return dailyVolume;
  }
}
