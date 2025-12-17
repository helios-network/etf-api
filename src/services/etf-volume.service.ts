import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EtfVolume, EtfVolumeDocument } from '../models/etf-volume.schema';
import { ETF, ETFDocument } from '../models/etf.schema';
import { normalizeEthAddress } from '../common/utils/eip55';

@Injectable()
export class EtfVolumeService {
  private readonly logger = new Logger(EtfVolumeService.name);
  private readonly TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  constructor(
    @InjectModel(EtfVolume.name)
    private etfVolumeModel: Model<EtfVolumeDocument>,
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
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

    const cutoffTime = Date.now() - this.TWENTY_FOUR_HOURS_MS;
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
          // Clean volumes older than 24h
          const filteredVolumes = etfVolume.volumes.filter(
            (v) => v.time >= cutoffTime,
          );

          // Calculate total
          const totalVolume = filteredVolumes.reduce(
            (sum, v) => sum + v.usd,
            0,
          );

          // Update etf-volume document if volumes were cleaned
          if (filteredVolumes.length !== etfVolume.volumes.length) {
            await this.etfVolumeModel.updateOne(
              { _id: etfVolume._id },
              { $set: { volumes: filteredVolumes } },
            );
          }

          // Update ETF dailyVolumeUSD
          await this.etfModel.updateOne(
            { vault: etfVolume.vault, chain: etfVolume.chain },
            { $set: { dailyVolumeUSD: Number(totalVolume.toFixed(2)) } },
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

