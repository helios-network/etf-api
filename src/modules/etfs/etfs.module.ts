import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EtfsController } from './etfs.controller';
import { EtfController } from './etf.controller';
import { EtfsService } from './etfs.service';
import { ETF, ETFSchema } from '../../models/etf.schema';
import {
  EtfPriceChart,
  EtfPriceChartSchema,
} from '../../models/etf-price-chart.schema';
import { Web3Service } from '../../services/web3.service';
import { EtfResolverService } from '../../services/etf-resolver.service';
import { UniswapV2ResolverService } from '../../services/uniswap-v2-resolver.service';
import { UniswapV3ResolverService } from '../../services/uniswap-v3-resolver.service';
import { EtfPriceChartService } from '../../services/etf-price-chart.service';
import { ChainlinkDataFeedsModule } from '../chainlink-data-feeds/chainlink-data-feeds.module';
import { RpcClientModule } from '../../services/rpc-client/rpc-client.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ETF.name, schema: ETFSchema },
      { name: EtfPriceChart.name, schema: EtfPriceChartSchema },
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
