import mongoose, { Schema, Document } from "mongoose"

export interface IPoolsRewards extends Document {
  type: string
  chain: number
  symbol: string
  decimals: number
  tokenAddress: string
  totalReward: {
    chain: number
    symbol: string
    tokenAddress: string
    quantity: bigint
    decimals: number
  }
  startDate: number
  endDate: number
  distributedRewards: string[]
  createdAt: Date
  updatedAt: Date
}

// Reward schema
const PoolsRewardsSchema: Schema = new Schema(
  {
    type: {
      type: String,
      enum: ["deposit", "borrow"],
      required: true,
    },
    chain: {
      type: Number,
      required: true,
    },
    symbol: {
      type: String,
      required: true,
    },
    decimals: {
      type: Number,
      required: true,
    },
    tokenAddress: {
      type: String,
      required: true,
    },
    totalReward: {
      chain: {
        type: Number,
        required: true,
      },
      symbol: {
        type: String,
        required: true,
      },
      tokenAddress: {
        type: String,
        required: true,
      },
      quantity: {
        type: BigInt,
        required: true,
      },
      decimals: {
        type: Number,
        required: true,
      },
    },
    startDate: {
      type: Number,
      required: true,
    },
    endDate: {
      type: Number,
      required: true,
    },
    distributedRewards: {
      type: [String],
      required: true,
      default: [],
    },
  },
  {
    timestamps: true,
  }
)

export default mongoose.model<IPoolsRewards>("PoolsRewards", PoolsRewardsSchema)
