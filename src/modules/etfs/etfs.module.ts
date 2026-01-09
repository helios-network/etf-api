import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ETF,
  ETFSchema,
  EtfPriceChart,
  EtfPriceChartSchema,
  WalletHolding,
  WalletHoldingSchema,
} from 'src/models';
import {
  EtfPriceChartService,
  RpcClientModule,
  UniswapV2ResolverService,
  UniswapV3ResolverService,
  EtfResolverService,
  Web3Service,
} from 'src/services';

import { EtfsController } from './etfs.controller';
import { EtfController } from './etf.controller';
import { EtfsService } from './etfs.service';
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
  controllers: [EtfsController, EtfController],
  providers: [
    EtfsService,
    Web3Service,
    EtfResolverService,
    UniswapV2ResolverService,
    UniswapV3ResolverService,
    EtfPriceChartService,
  ],
  exports: [EtfsService],
})
export class EtfsModule {}
