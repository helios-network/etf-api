import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChainlinkDataFeedsController } from './chainlink-data-feeds.controller';
import { ChainlinkDataFeedsService } from './chainlink-data-feeds.service';
import {
  ChainlinkDataFeed,
  ChainlinkDataFeedSchema,
} from '../../models/chainlink-data-feed.schema';
import { ChainlinkResolverService } from '../../services/chainlink-resolver.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChainlinkDataFeed.name, schema: ChainlinkDataFeedSchema },
    ]),
  ],
  controllers: [ChainlinkDataFeedsController],
  providers: [ChainlinkDataFeedsService, ChainlinkResolverService],
  exports: [ChainlinkDataFeedsService, ChainlinkResolverService],
})
export class ChainlinkDataFeedsModule {}
