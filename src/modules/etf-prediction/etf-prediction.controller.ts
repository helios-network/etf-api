import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { EtfPriceChartService } from 'src/services';
import { handleError } from 'src/utils/error';

import { EtfPredictionService } from './etf-prediction.service';

@Controller('etf-prediction')
export class EtfPredictionController {
  constructor(
    private readonly etfPredictionService: EtfPredictionService,
    private readonly etfPriceChartService: EtfPriceChartService,
  ) { }

  @Get()
  async getAll(@Query('vault') vault: string) {
    try {
      const result = await this.etfPredictionService.getEtfWithVault(vault);
      return result;
    } catch (error) {
      handleError(error)
    }
  }
}
