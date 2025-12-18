import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { WalletHolding, WalletHoldingSchema } from '../../models/wallet-holding.schema';
import {
  LeaderBoardRewards,
  LeaderBoardRewardsSchema,
} from '../../models/leader-board-rewards.schema';
import { Web3Service } from '../../services/web3.service';
import { RpcClientModule } from '../../services/rpc-client/rpc-client.module';

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
