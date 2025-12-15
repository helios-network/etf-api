import { Module } from '@nestjs/common';
import { EtfsController } from './etfs.controller';
import { EtfController } from './etf.controller';
import { EtfsService } from './etfs.service';

@Module({
  controllers: [EtfsController, EtfController],
  providers: [EtfsService],
  exports: [EtfsService],
})
export class EtfsModule {}
