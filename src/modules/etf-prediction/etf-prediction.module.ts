import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ETF, ETFSchema, EtfPriceChart, EtfPriceChartSchema, WalletHolding, WalletHoldingSchema } from 'src/models';
import { EtfPriceChartService, RpcClientModule, UniswapV2ResolverService, UniswapV3ResolverService, EtfResolverService, Web3Service } from 'src/services';

import { EtfPredictionController } from './etf-prediction.controller';
import { EtfPredictionService } from './etf-prediction.service';
import { ChainlinkDataFeedsModule } from '../chainlink-data-feeds/chainlink-data-feeds.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ETF.name, schema: ETFSchema },
      { name: EtfPriceChart.name, schema: EtfPriceChartSchema },
      { name: WalletHolding.name, schema: WalletHoldingSchema },
    ]),
    ChainlinkDataFeedsModule, // For ChainlinkResolverService
    RpcClientModule, // For RPC client management
  ],
  controllers: [EtfPredictionController],
  providers: [EtfPredictionService, Web3Service, EtfResolverService, UniswapV2ResolverService, UniswapV3ResolverService, EtfPriceChartService],
  exports: [EtfPredictionService],
})
export class EtfPredictionModule {}
