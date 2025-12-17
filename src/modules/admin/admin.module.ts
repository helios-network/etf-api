import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { VolumeSyncJob } from '../jobs/volume-sync.job';
import { EtfVolumeService } from '../../services/etf-volume.service';
import { Event, EventSchema } from '../../models/event.schema';
import { ETF, ETFSchema } from '../../models/etf.schema';
import {
  WalletHolding,
  WalletHoldingSchema,
} from '../../models/wallet-holding.schema';
import {
  EtfVolume,
  EtfVolumeSchema,
} from '../../models/etf-volume.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: ETF.name, schema: ETFSchema },
      { name: WalletHolding.name, schema: WalletHoldingSchema },
      { name: EtfVolume.name, schema: EtfVolumeSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [VolumeSyncJob, EtfVolumeService],
})
export class AdminModule {}
