import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ETFDocument = ETF & Document;

export interface AssetConfig {
  token: string;
  feed: string;
  targetWeightBps: number;
  v2Path?: string[];
  v3Path?: string;
  v3PoolFee?: number;
  symbol?: string;
  decimals?: number;
  tvl?: string;
}

@Schema({ timestamps: true })
export class ETF {
  @Prop({ required: true, unique: true })
  vault: string;

  @Prop({ required: true })
  chain: number;

  @Prop({ required: true })
  shareToken: string;

  @Prop({ required: true })
  depositToken: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  symbol: string;

  @Prop({ type: Number, default: 0 })
  tvl: number;

  @Prop({ type: Number, default: 0 })
  sharePrice?: number;

  @Prop({ type: Number, default: 0 })
  totalSupply?: number;

  @Prop({ type: String, required: true }) // Store BigInt as string
  eventNonce: string;

  @Prop({ type: String, required: true }) // Store BigInt as string
  eventHeight: string;

  @Prop({ type: String, required: true }) // Store BigInt as string
  etfNonce: string;

  @Prop({ type: String })
  factory?: string;

  @Prop({ type: String })
  owner?: string;

  @Prop({ type: String })
  pricer?: string;

  @Prop({ type: String })
  pricingMode?: string;

  @Prop({ type: String })
  depositFeed?: string;

  @Prop({ type: Number, default: 0 })
  volumeTradedUSD: number;

  @Prop({ type: Number, default: 0 })
  dailyVolumeUSD: number;

  @Prop({ type: Number, default: 0 })
  priceChange24h?: number;

  @Prop({ type: Number, default: 0 })
  priceChange7d?: number;

  @Prop({ type: Number, default: 0 })
  priceChange30d?: number;

  @Prop({ type: Number, default: 0 })
  depositCount: number;

  @Prop({ type: Number, default: 0 })
  redeemCount: number;

  @Prop({
    type: [
      {
        token: { type: String, required: true },
        feed: { type: String, required: true },
        targetWeightBps: { type: Number, required: true },
        v2Path: { type: [String] },
        v3Path: { type: String },
        v3PoolFee: { type: Number },
        symbol: { type: String },
        decimals: { type: Number },
        tvl: { type: String },
      },
    ],
    default: [],
  })
  assets?: AssetConfig[];

  @Prop({ type: String }) // Store BigInt as string
  imbalanceThresholdBps?: string;

  @Prop({ type: String })
  depositSymbol?: string;

  @Prop({ type: Number })
  depositDecimals?: number;

  @Prop({ type: Number })
  shareDecimals?: number;

  @Prop({ type: Date })
  latestRebalanceDate?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ETFSchema = SchemaFactory.createForClass(ETF);

// Indexes for performance optimization
// Note: vault already has unique index via @Prop({ unique: true })
ETFSchema.index({ chain: 1 });
