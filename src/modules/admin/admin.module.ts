import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EtfVolumeService } from 'src/services';
import {
  Event,
  EventSchema,
  ETF,
  ETFSchema,
  WalletHolding,
  WalletHoldingSchema,
  EtfVolume,
  EtfVolumeSchema,
  EtfPriceChart,
  EtfPriceChartSchema,
} from 'src/models';

import { AdminController } from './admin.controller';
import { VolumeSyncJob } from '../jobs/volume-sync.job';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: ETF.name, schema: ETFSchema },
      { name: WalletHolding.name, schema: WalletHoldingSchema },
      { name: EtfVolume.name, schema: EtfVolumeSchema },
      { name: EtfPriceChart.name, schema: EtfPriceChartSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [VolumeSyncJob, EtfVolumeService],
})
export class AdminModule {}
