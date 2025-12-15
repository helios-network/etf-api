import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeaderBoardController } from './leader-board.controller';
import { LeaderBoardService } from './leader-board.service';
import { WalletHolding, WalletHoldingSchema } from '../../models/wallet-holding.schema';
import { ETF, ETFSchema } from '../../models/etf.schema';
import { WalletHoldingUtilsService } from '../../services/wallet-holding-utils.service';

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
