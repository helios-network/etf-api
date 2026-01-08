import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Event,
  EventSchema,
  ObserveEvents,
  ObserveEventsSchema,
  ETF,
  ETFSchema,
  WalletHolding,
  WalletHoldingSchema,
  ChainlinkDataFeed,
  ChainlinkDataFeedSchema,
  LeaderBoardRewards,
  LeaderBoardRewardsSchema,
  EtfVolume,
  EtfVolumeSchema,
  EtfPriceChart,
  EtfPriceChartSchema,
} from 'src/models';
import {
  Web3Service,
  VaultUtilsService,
  WalletHoldingUtilsService,
  EtfVolumeService,
  EtfPriceChartService,
  RpcClientModule,
} from 'src/services';

import { EventProcessingJob } from './event-processing.job';
import { ChainlinkSyncJob } from './chainlink-sync.job';
import { RewardDistributionJob } from './reward-distribution.job';
import { VolumeSyncJob } from './volume-sync.job';
import { AddEtfPriceChartEntryJob } from './add-etf-price-chart-entry.job';

@Module({
  imports: [
    RpcClientModule,
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: ObserveEvents.name, schema: ObserveEventsSchema },
      { name: ETF.name, schema: ETFSchema },
      { name: WalletHolding.name, schema: WalletHoldingSchema },
      { name: ChainlinkDataFeed.name, schema: ChainlinkDataFeedSchema },
      { name: LeaderBoardRewards.name, schema: LeaderBoardRewardsSchema },
      { name: EtfVolume.name, schema: EtfVolumeSchema },
      { name: EtfPriceChart.name, schema: EtfPriceChartSchema },
    ]),
  ],
  providers: [
    Web3Service,
    VaultUtilsService,
    WalletHoldingUtilsService,
    EtfVolumeService,
    EtfPriceChartService,
    EventProcessingJob,
    ChainlinkSyncJob,
    RewardDistributionJob,
    VolumeSyncJob,
    AddEtfPriceChartEntryJob,
  ],
  exports: [VolumeSyncJob],
})
export class JobsModule {}
