import {
  Controller,
  Post,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { VolumeSyncJob } from '../jobs/volume-sync.job';
import { EtfVolumeService } from '../../services/etf-volume.service';

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly volumeSyncJob: VolumeSyncJob,
    private readonly etfVolumeService: EtfVolumeService,
  ) {
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

  @Post('daily-volume-cleanup')
  async cleanupDailyVolumes() {
    try {
      await this.etfVolumeService.cleanupAndRecalculateAll();
      return {
        success: true,
        message: 'Daily volumes cleanup completed',
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

  @Post('daily-volume-recalc/:vault')
  async recalculateDailyVolumeForVault(
    @Param('vault') vault: string,
    @Query('chain') chain: string,
  ) {
    try {
      if (!chain) {
        throw new HttpException(
          {
            success: false,
            error: 'Chain parameter is required',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const chainId = parseInt(chain, 10);
      if (isNaN(chainId)) {
        throw new HttpException(
          {
            success: false,
            error: 'Invalid chain parameter',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const dailyVolume = await this.etfVolumeService.recalculateForVault(
        vault,
        chainId,
      );

      return {
        success: true,
        message: `Daily volume recalculated for vault ${vault} on chain ${chainId}`,
        data: {
          vault,
          chain: chainId,
          dailyVolumeUSD: dailyVolume,
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
