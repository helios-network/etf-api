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
import { Web3Service } from '../../services/web3.service';
import { VaultUtilsService } from '../../services/vault-utils.service';
import { WalletHoldingUtilsService } from '../../services/wallet-holding-utils.service';
import { EventProcessingJob } from './event-processing.job';
import { ChainlinkSyncJob } from './chainlink-sync.job';
import { RewardDistributionJob } from './reward-distribution.job';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: ObserveEvents.name, schema: ObserveEventsSchema },
      { name: ETF.name, schema: ETFSchema },
      { name: WalletHolding.name, schema: WalletHoldingSchema },
      { name: ChainlinkDataFeed.name, schema: ChainlinkDataFeedSchema },
      { name: LeaderBoardRewards.name, schema: LeaderBoardRewardsSchema },
    ]),
  ],
  providers: [
    Web3Service,
    VaultUtilsService,
    WalletHoldingUtilsService,
    EventProcessingJob,
    ChainlinkSyncJob,
    RewardDistributionJob,
  ],
})
export class JobsModule {}
