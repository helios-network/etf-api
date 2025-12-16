import {
  Controller,
  Post,
  Param,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { VolumeSyncJob } from '../jobs/volume-sync.job';

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(private readonly volumeSyncJob: VolumeSyncJob) {
    this.logger.log('AdminController initialized');
  }

  @Post('volume-sync')
  async resyncAllVolumes() {
    try {
      await this.volumeSyncJob.resyncVolumeTradedUSD();
      return {
        success: true,
        message: 'Volume resynchronization started',
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('volume-sync/:wallet')
  async resyncWalletVolume(@Param('wallet') wallet: string) {
    try {
      const newVolume = await this.volumeSyncJob.resyncVolumeForWallet(wallet);
      return {
        success: true,
        message: `Volume resynchronized for wallet ${wallet}`,
        data: {
          wallet,
          volumeTradedUSD: newVolume,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('transaction-sync')
  async resyncAllTransactionCounts() {
    try {
      await this.volumeSyncJob.resyncTransactionCounts();
      return {
        success: true,
        message: 'Transaction counts resynchronization started',
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('transaction-counts-sync/:wallet')
  async resyncWalletTransactionCounts(@Param('wallet') wallet: string) {
    try {
      const counts = await this.volumeSyncJob.resyncTransactionCountsForWallet(
        wallet,
      );
      return {
        success: true,
        message: `Transaction counts resynchronized for wallet ${wallet}`,
        data: {
          wallet,
          transactionCounts: counts,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('points-sync')
  async resyncAllPoints() {
    try {
      await this.volumeSyncJob.resyncTransactionCountsAndPoints();
      return {
        success: true,
        message: 'Transaction counts and points resynchronization started',
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('points-sync/:wallet')
  async resyncWalletPoints(@Param('wallet') wallet: string) {
    try {
      const result =
        await this.volumeSyncJob.resyncTransactionCountsAndPointsForWallet(
          wallet,
        );
      return {
        success: true,
        message: `Transaction counts and points resynchronized for wallet ${wallet}`,
        data: {
          wallet,
          ...result,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
