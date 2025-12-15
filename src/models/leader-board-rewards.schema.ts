import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LeaderBoardRewardsDocument = LeaderBoardRewards & Document;

@Schema({ timestamps: true })
export class LeaderBoardRewards {
  @Prop({ required: true })
  chain: number;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  decimals: number;

  @Prop({ required: true })
  tokenAddress: string;

  @Prop({
    type: {
      chain: { type: Number, required: true },
      symbol: { type: String, required: true },
      tokenAddress: { type: String, required: true },
      quantity: { type: String, required: true }, // Store BigInt as string
      decimals: { type: Number, required: true },
    },
    required: true,
  })
  totalReward: {
    chain: number;
    symbol: string;
    tokenAddress: string;
    quantity: string; // BigInt stored as string
    decimals: number;
  };

  @Prop({ required: true })
  startDate: number;

  @Prop({ required: true })
  endDate: number;

  @Prop({ type: [String], required: true, default: [] })
  distributedRewards: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const LeaderBoardRewardsSchema =
  SchemaFactory.createForClass(LeaderBoardRewards);
