import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { VolumeSyncJob } from '../jobs/volume-sync.job';
import { Event, EventSchema } from '../../models/event.schema';
import { ETF, ETFSchema } from '../../models/etf.schema';
import {
  WalletHolding,
  WalletHoldingSchema,
} from '../../models/wallet-holding.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: ETF.name, schema: ETFSchema },
      { name: WalletHolding.name, schema: WalletHoldingSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [VolumeSyncJob],
})
export class AdminModule {}
