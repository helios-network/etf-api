import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WalletHoldingDocument = WalletHolding & Document;

@Schema({ timestamps: true })
export class WalletHolding {
  @Prop({ required: true })
  wallet: string;

  @Prop({
    type: [
      {
        chain: { type: Number, required: true },
        symbol: { type: String, required: true },
        decimals: { type: Number, required: true },
        etfVaultAddress: { type: String, required: true },
        etfTokenAddress: { type: String, required: true },
        amount: { type: String, required: true }, // Store BigInt as string
        amountUSD: { type: Number, default: 0 },
      },
    ],
    default: [],
  })
  deposits: Array<{
    chain: number;
    symbol: string;
    decimals: number;
    etfVaultAddress: string;
    etfTokenAddress: string;
    amount: string; // BigInt stored as string
    amountUSD: number;
  }>;

  @Prop({ type: Number, default: 0 })
  tvl: number;

  @Prop({
    type: [
      {
        chain: { type: Number, required: true },
        symbol: { type: String, required: true },
        amount: { type: String, required: true }, // Store BigInt as string
        date: { type: Number },
        hash: { type: String },
      },
    ],
    default: [],
  })
  rewards: Array<{
    chain: number;
    symbol: string;
    amount: string; // BigInt stored as string
    date?: number;
    hash?: string;
  }>;

  @Prop({ type: Number, default: 0 })
  transactionsPerformed: number;

  @Prop({ type: Number, default: 0 })
  volumeTradedUSD: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WalletHoldingSchema = SchemaFactory.createForClass(WalletHolding);

// Indexes for performance optimization
WalletHoldingSchema.index({ wallet: 1 }, { unique: true });
WalletHoldingSchema.index({ 'deposits.chain': 1, 'deposits.symbol': 1 });
