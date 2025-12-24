import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChainlinkDataFeed, ChainlinkDataFeedSchema } from 'src/models';
import { ChainlinkResolverService } from 'src/services';

import { ChainlinkDataFeedsController } from './chainlink-data-feeds.controller';
import { ChainlinkDataFeedsService } from './chainlink-data-feeds.service';

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
