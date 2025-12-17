import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Event, EventSchema } from '../../models/event.schema';
import {
  ObserveEvents,
  ObserveEventsSchema,
} from '../../models/observe-events.schema';
import { ETF, ETFSchema } from '../../models/etf.schema';
import {
  WalletHolding,
  WalletHoldingSchema,
} from '../../models/wallet-holding.schema';
import {
  ChainlinkDataFeed,
  ChainlinkDataFeedSchema,
} from '../../models/chainlink-data-feed.schema';
import {
  LeaderBoardRewards,
  LeaderBoardRewardsSchema,
} from '../../models/leader-board-rewards.schema';
import {
  EtfVolume,
  EtfVolumeSchema,
} from '../../models/etf-volume.schema';
import { Web3Service } from '../../services/web3.service';
import { VaultUtilsService } from '../../services/vault-utils.service';
import { WalletHoldingUtilsService } from '../../services/wallet-holding-utils.service';
import { EtfVolumeService } from '../../services/etf-volume.service';
import { RpcRateLimitModule } from '../../services/rpc-rate-limit/rpc-rate-limit.module';
import { EventProcessingJob } from './event-processing.job';
import { ChainlinkSyncJob } from './chainlink-sync.job';
import { RewardDistributionJob } from './reward-distribution.job';
import { VolumeSyncJob } from './volume-sync.job';

@Module({
  imports: [
    RpcRateLimitModule,
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: ObserveEvents.name, schema: ObserveEventsSchema },
      { name: ETF.name, schema: ETFSchema },
      { name: WalletHolding.name, schema: WalletHoldingSchema },
      { name: ChainlinkDataFeed.name, schema: ChainlinkDataFeedSchema },
      { name: LeaderBoardRewards.name, schema: LeaderBoardRewardsSchema },
      { name: EtfVolume.name, schema: EtfVolumeSchema },
    ]),
  ],
  providers: [
    Web3Service,
    VaultUtilsService,
    WalletHoldingUtilsService,
    EtfVolumeService,
    EventProcessingJob,
    ChainlinkSyncJob,
    RewardDistributionJob,
    VolumeSyncJob,
  ],
  exports: [VolumeSyncJob],
})
export class JobsModule {}
