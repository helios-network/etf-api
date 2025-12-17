import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EtfVolumeDocument = EtfVolume & Document;

@Schema({ timestamps: true })
export class EtfVolume {
  @Prop({ required: true })
  vault: string;

  @Prop({ required: true })
  chain: number;

  @Prop({
    type: [
      {
        time: { type: Number, required: true },
        usd: { type: Number, required: true },
      },
    ],
    default: [],
  })
  volumes: Array<{
    time: number;
    usd: number;
  }>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EtfVolumeSchema = SchemaFactory.createForClass(EtfVolume);

// Indexes for performance optimization
EtfVolumeSchema.index({ vault: 1, chain: 1 }, { unique: true });
EtfVolumeSchema.index({ vault: 1 });
EtfVolumeSchema.index({ chain: 1 });

