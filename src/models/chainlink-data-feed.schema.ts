import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChainlinkDataFeedDocument = ChainlinkDataFeed & Document;

export interface Oracle {
  operator: string;
}

export interface Docs {
  assetClass?: string;
  assetSubClass?: string;
  assetName?: string;
  attributeType?: string;
  baseAsset?: string;
  baseAssetClic?: string;
  baseAssetEntityId?: string;
  blockchainName?: string;
  clicProductName?: string;
  deliveryChannelCode?: string;
  feedCategory?: string;
  feedType?: string;
  hidden?: boolean;
  marketHours?: string;
  productSubType?: string;
  productType?: string;
  productTypeCode?: string;
  quoteAsset?: string;
  quoteAssetClic?: string;
  quoteAssetEntityId?: string;
  serviceLevel?: string;
  shutdownDate?: string;
  underlyingAsset?: string;
  underlyingAssetClic?: string;
}

@Schema({ timestamps: true })
export class ChainlinkDataFeed {
  @Prop({ type: String, default: '' })
  compareOffchain: string;

  @Prop({ type: String, default: '' })
  contractAddress: string;

  @Prop({ type: String, default: '' })
  contractType: string;

  @Prop({ type: Number, default: 0 })
  contractVersion: number;

  @Prop({ type: Number, default: null })
  decimalPlaces: number | null;

  @Prop({ type: String, default: null })
  ens: string | null;

  @Prop({ type: Number, default: null })
  formatDecimalPlaces: number | null;

  @Prop({ type: String, default: '' })
  healthPrice: string;

  @Prop({ type: Boolean, default: null })
  history: boolean | null;

  @Prop({ type: String, default: '' })
  multiply: string;

  @Prop({ type: String, default: '' })
  name: string;

  @Prop({ type: [String], default: [] })
  pair: string[];

  @Prop({ type: String, default: '' })
  path: string;

  @Prop({ type: String, default: null })
  proxyAddress: string | null;

  @Prop({ type: Number, default: 0 })
  threshold: number;

  @Prop({ type: String, default: '' })
  valuePrefix: string;

  @Prop({ type: String, default: '' })
  assetName: string;

  @Prop({ type: String, default: '' })
  feedCategory: string;

  @Prop({ type: String, default: '' })
  feedType: string;

  @Prop({ type: Object, default: {} })
  docs: Docs;

  @Prop({ type: Number, default: 0 })
  decimals: number;

  @Prop({ type: String, default: null })
  feedId: string | null;

  @Prop({ type: Number, default: 0 })
  sourceChain: number;

  @Prop({ type: String, default: '' })
  status: string;

  @Prop({
    type: [
      {
        operator: { type: String, required: true },
      },
    ],
    default: [],
  })
  oracles: Oracle[];

  @Prop({ type: Number })
  heartbeat?: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ChainlinkDataFeedSchema =
  SchemaFactory.createForClass(ChainlinkDataFeed);

// Create indexes
ChainlinkDataFeedSchema.index({ proxyAddress: 1 }, { unique: true, sparse: true });
ChainlinkDataFeedSchema.index({ path: 1, sourceChain: 1 }, { unique: true, sparse: true });
