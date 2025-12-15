import { Module } from '@nestjs/common';
import { ChainlinkDataFeedsController } from './chainlink-data-feeds.controller';
import { ChainlinkDataFeedsService } from './chainlink-data-feeds.service';

@Module({
  controllers: [ChainlinkDataFeedsController],
  providers: [ChainlinkDataFeedsService],
  exports: [ChainlinkDataFeedsService],
})
export class ChainlinkDataFeedsModule {}
