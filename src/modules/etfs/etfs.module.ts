import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EtfsController } from './etfs.controller';
import { EtfController } from './etf.controller';
import { EtfsService } from './etfs.service';
import { ETF, ETFSchema } from '../../models/etf.schema';
import { Web3Service } from '../../services/web3.service';
import { EtfResolverService } from '../../services/etf-resolver.service';
import { UniswapV2ResolverService } from '../../services/uniswap-v2-resolver.service';
import { UniswapV3ResolverService } from '../../services/uniswap-v3-resolver.service';
import { ChainlinkDataFeedsModule } from '../chainlink-data-feeds/chainlink-data-feeds.module';
import { RpcRateLimitModule } from '../../services/rpc-rate-limit/rpc-rate-limit.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ETF.name, schema: ETFSchema }]),
    ChainlinkDataFeedsModule, // For ChainlinkResolverService
    RpcRateLimitModule, // For RPC rate limiting
  ],
  controllers: [EtfsController, EtfController],
  providers: [
    EtfsService,
    Web3Service,
    EtfResolverService,
    UniswapV2ResolverService,
    UniswapV3ResolverService,
  ],
  exports: [EtfsService],
})
export class EtfsModule {}
