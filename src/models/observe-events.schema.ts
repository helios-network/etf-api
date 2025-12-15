import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ObserveEventsDocument = ObserveEvents & Document;

@Schema({ timestamps: true })
export class ObserveEvents {
  @Prop({ required: true, unique: true })
  chain: number;

  @Prop({ type: String, required: true }) // Store BigInt as string
  lastBlockNumber: string;

  @Prop({ type: String, required: true }) // Store BigInt as string
  lastNonce: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ObserveEventsSchema = SchemaFactory.createForClass(ObserveEvents);

// Note: chain already has unique index via @Prop({ unique: true })
