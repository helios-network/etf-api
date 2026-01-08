import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MasterOnly } from 'src/common/decorators/master-only.decorator';
import { ETF, ETFDocument } from 'src/models';
import { EtfPriceChartService, VaultUtilsService } from 'src/services';
import { normalizeEthAddress } from 'src/common/utils/eip55';

@Injectable()
@MasterOnly()
export class AddEtfPriceChartEntryJob {
  private readonly logger = new Logger(AddEtfPriceChartEntryJob.name);
  private isRunning = false;

  constructor(
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
    private readonly vaultUtils: VaultUtilsService,
    private readonly etfPriceChartService: EtfPriceChartService,
  ) {}

  private async processEtfPriceChartEntry() {
    const total = await this.etfModel.countDocuments({});
    let etfIndex = 0;
    const perPage = 10;

    while (true) {
      const etfs = await this.etfModel
        .find({})
        .sort({ createdAt: -1 })
        .skip(etfIndex)
        .limit(perPage)
        .lean()
        .exec();
      if (etfs.length === 0) break;
      const portfolios = await Promise.all(
        etfs.map((etf) =>
          this.vaultUtils.fetchVaultPortfolio(
            normalizeEthAddress(etf.vault) as `0x${string}`,
            etf.chain,
            etf.shareDecimals,
          ),
        ),
      );

      for (let index = 0; index < etfs.length; index++) {
        const etf = etfs[index];
        await this.etfModel.updateOne(
          { _id: etf._id },
          {
            $set: {
              tvl: portfolios[index].totalValue,
              sharePrice: portfolios[index].nav,
            },
          },
        );
        await this.etfPriceChartService.addPriceChartEntry(
          etf.vault,
          0,
          etf.sharePrice || 0,
          Date.now(),
        );
      }

      etfIndex += perPage;
    }
  }

  /**
   * Main function that orchestrates the reward distribution process
   */
  @Cron(CronExpression.EVERY_HOUR) // Every 1 hour
  async process(): Promise<void> {
    // Check if job is already running
    if (this.isRunning) {
      return;
    }

    // Set mutex flag
    this.isRunning = true;
    this.logger.log('Add EtfPriceChartEntry Job process');
    try {
      await this.processEtfPriceChartEntry();
    } catch (error) {
      // Enhanced error handling for MongoDB and other errors
      if (error instanceof Error) {
        // Check if it's a MongoDB connection error
        const errorMessage = error.message.toLowerCase();
        if (
          errorMessage.includes('mongodb') ||
          errorMessage.includes('connection') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('network')
        ) {
          this.logger.error(
            `MongoDB error in event processing job: ${error.message}`,
            error.stack,
          );
          // Don't crash the job, it will retry on next execution
        } else {
          this.logger.error(`Error in event processing job: ${error.message}`);
        }
      } else {
        this.logger.error(`Unknown error in event processing job`);
      }
      // Job will continue on next cron execution
    } finally {
      // Always release mutex flag
      this.isRunning = false;
    }
  }
}
