import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { EtfsService } from './etfs.service';
import { VerifyEtfDto } from './dto/verify-etf.dto';
import { EtfPriceChartService } from '../../services/etf-price-chart.service';

/**
 * Controller pour les routes /etf (alias sans préfixe /api)
 * Note: Ce controller expose les mêmes routes que EtfsController mais sans préfixe /api
 */
@Controller('etf')
export class EtfController {
  constructor(
    private readonly etfsService: EtfsService,
    private readonly etfPriceChartService: EtfPriceChartService,
  ) {}

  @Get()
  async getAll(@Query('page') page?: string, @Query('size') size?: string, @Query('search') search?: string) {
    try {
      const pageNum = parseInt(page || '1', 10);
      const sizeNum = parseInt(size || '10', 10);
      const result = await this.etfsService.getAll(pageNum, sizeNum, search);

      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('must be')) {
        throw new BadRequestException({
          success: false,
          error: error.message,
        });
      }
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('stats')
  async getStatistics() {
    try {
      const result = await this.etfsService.getStatistics();
      return result;
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

  @Get('deposit-tokens')
  async getDepositTokens(@Query('chainId') chainId: number, @Query('search') search?: string) {
    try {
      return await this.etfsService.getDepositTokens(chainId, search);
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

  @Post('verify')
  async verifyETF(@Body() body: VerifyEtfDto) {
    try {
      const result = await this.etfsService.verifyETF(body);

      // Check if it's an error response
      if (result.status === 'ERROR') {
        throw new BadRequestException(result);
      }

      return result;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Internal error
      throw new HttpException(
        {
          status: 'ERROR',
          reason: 'INTERNAL_ERROR',
          details: {
            token: '',
            message: error instanceof Error ? error.message : 'Unknown error occurred',
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('chart')
  async getChart(
    @Query('vaultAddress') vaultAddress?: string,
    @Query('period') period?: string,
  ) {
    try {
      if (!vaultAddress) {
        throw new BadRequestException({
          success: false,
          error: 'vaultAddress parameter is required',
        });
      }

      if (!period) {
        throw new BadRequestException({
          success: false,
          error: 'period parameter is required',
        });
      }

      const validPeriods = ['24h', '7d', '1m', 'all'];
      if (!validPeriods.includes(period)) {
        throw new BadRequestException({
          success: false,
          error: `period must be one of: ${validPeriods.join(', ')}`,
        });
      }

      const chartData = await this.etfPriceChartService.getChartData(
        vaultAddress,
        period as '24h' | '7d' | '1m' | 'all',
      );

      return {
        success: true,
        data: chartData,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
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
