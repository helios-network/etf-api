import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { EtfPriceChartService } from 'src/services';
import { handleError } from 'src/utils/error';

import { EtfsService } from './etfs.service';
import { VerifyEtfDto } from './dto/verify-etf.dto';

/**
 * Controller pour les routes /etf (alias sans préfixe /api)
 * Note: Ce controller expose les mêmes routes que EtfsController mais sans préfixe /api
 */
@Controller('etf')
export class EtfController {
  constructor(
    private readonly etfsService: EtfsService,
    private readonly etfPriceChartService: EtfPriceChartService,
  ) { }

  @Get()
  async getAll(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('search') search?: string,
  ) {
    try {
      const pageNum = parseInt(page || '1', 10);
      const sizeNum = parseInt(size || '10', 10);
      const result = await this.etfsService.getAll(pageNum, sizeNum, search);

      return result;
    } catch (error) {
      handleError(error)
    }
  }

  @Get('stats')
  async getStatistics() {
    try {
      const result = await this.etfsService.getStatistics();
      return result;
    } catch (error) {
      handleError(error)
    }
  }

  @Get('deposit-tokens')
  async getDepositTokens(
    @Query('chainId') chainId: number,
    @Query('search') search?: string,
  ) {
    try {
      return await this.etfsService.getDepositTokens(chainId, search);
    } catch (error) {
      handleError(error)
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
      handleError(error)
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
      handleError(error)
    }
  }
}
