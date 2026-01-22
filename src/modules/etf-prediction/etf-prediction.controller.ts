import { Controller, Get, Post, Body, Query, BadRequestException, HttpException, HttpStatus, Param } from '@nestjs/common';
import { EtfPriceChartService } from 'src/services/etf-price-chart.service';
import { ETF_CONTRACT_ADDRS } from 'src/constants';
import { ChainId } from 'src/config/web3';

import { EtfPredictionService } from './etf-prediction.service';

@Controller('etf-prediction')
export class EtfPredictionController {
  constructor(private readonly etfPredictionService: EtfPredictionService, private readonly etfPriceChartService: EtfPriceChartService) { }

  @Get()
  async getAll(@Query('vault') vault: string) {
    try {
      const result = await this.etfPredictionService.getEtfWithVault(vault);
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
}
