import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletHolding, WalletHoldingSchema, ETF, ETFSchema } from 'src/models';
import { WalletHoldingUtilsService } from 'src/services';

import { LeaderBoardController } from './leader-board.controller';
import { LeaderBoardService } from './leader-board.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WalletHolding.name, schema: WalletHoldingSchema },
      { name: ETF.name, schema: ETFSchema },
    ]),
  ],
  controllers: [LeaderBoardController],
  providers: [LeaderBoardService, WalletHoldingUtilsService],
  exports: [LeaderBoardService],
})
export class LeaderBoardModule {}
