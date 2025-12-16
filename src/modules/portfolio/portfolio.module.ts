import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import {
  WalletHolding,
  WalletHoldingSchema,
} from '../../models/wallet-holding.schema';
import { ETF, ETFSchema } from '../../models/etf.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WalletHolding.name, schema: WalletHoldingSchema },
      { name: ETF.name, schema: ETFSchema },
    ]),
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}

