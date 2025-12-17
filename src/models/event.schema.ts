import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EventDocument = Event & Document;

@Schema({ timestamps: true })
export class Event {
  @Prop({ required: false })
  skipped?: boolean;

  @Prop({
    type: String,
    enum: ['Deposit', 'Redeem', 'ETFCreated', 'Rebalance', 'ParamsUpdated'],
    required: true,
  })
  type: string;

  @Prop({ required: true })
  chain: number;

  @Prop({ required: false })
  user?: string;

  @Prop()
  token?: string;

  @Prop({ type: String }) // Store BigInt as string
  amount?: string;

  @Prop({ type: String, required: true }) // Store BigInt as string
  nonce: string;

  @Prop()
  vault?: string;

  @Prop({ type: String })
  depositAmount?: string;

  @Prop({ type: String })
  sharesOut?: string;

  @Prop({ type: String })
  sharesIn?: string;

  @Prop({ type: String })
  depositOut?: string;

  @Prop({ type: [String] })
  amountsOut?: string[];

  @Prop({ type: [String] })
  valuesPerAsset?: string[];

  @Prop({ type: [String] })
  soldAmounts?: string[];

  @Prop({ type: String })
  fromIndex?: string;

  @Prop({ type: String })
  toIndex?: string;

  @Prop({ type: String })
  moveValue?: string;

  @Prop({ type: String })
  bought?: string;

  @Prop({ type: String })
  imbalanceThresholdBps?: string;

  @Prop({ type: String })
  maxPriceStaleness?: string;

  @Prop({ type: String })
  hlsBalance?: string;

  @Prop({ type: String })
  eventHeight?: string;

  @Prop({ type: String })
  etfNonce?: string;

  @Prop({ type: String })
  etfHeight?: string;

  @Prop()
  shareToken?: string;

  @Prop()
  depositToken?: string;

  @Prop()
  name?: string;

  @Prop()
  symbol?: string;

  @Prop({ type: String, required: true }) // Store BigInt as string
  blockNumber: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EventSchema = SchemaFactory.createForClass(Event);

// Indexes for performance optimization
EventSchema.index({ chain: 1, blockNumber: -1, nonce: -1 });
EventSchema.index({ chain: 1, nonce: -1 });
