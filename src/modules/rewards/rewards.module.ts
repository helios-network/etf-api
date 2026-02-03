import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WalletHolding,
  WalletHoldingSchema,
  LeaderBoardRewards,
  LeaderBoardRewardsSchema,
} from 'src/models';
import { Web3Service, RpcClientModule } from 'src/services';

import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WalletHolding.name, schema: WalletHoldingSchema },
      { name: LeaderBoardRewards.name, schema: LeaderBoardRewardsSchema },
    ]),
    RpcClientModule,
  ],
  controllers: [RewardsController],
  providers: [RewardsService, Web3Service],
  exports: [RewardsService],
})
export class RewardsModule {}
