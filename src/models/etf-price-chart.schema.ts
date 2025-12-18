import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EtfPriceChartDocument = EtfPriceChart & Document;

@Schema({ timestamps: true })
export class EtfPriceChart {
  @Prop({ required: true, unique: true })
  vaultAddress: string;

  @Prop({
    type: [
      {
        timestamp: { type: Number, required: true },
        volumeUSD: { type: Number, required: true },
        sharePrice: { type: Number, required: true },
      },
    ],
    default: [],
  })
  entries: Array<{
    timestamp: number;
    volumeUSD: number;
    sharePrice: number;
  }>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EtfPriceChartSchema = SchemaFactory.createForClass(EtfPriceChart);

// Indexes for performance optimization
EtfPriceChartSchema.index({ vaultAddress: 1 }, { unique: true });
EtfPriceChartSchema.index({ 'entries.timestamp': 1 });

