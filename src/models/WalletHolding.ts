import mongoose, { Schema, Document } from "mongoose"

export interface IWalletHolding extends Document {
  wallet: string
  borrows: {
    chain: number
    symbol: string
    amount: bigint
  }[]
  deposits: {
    chain: number
    symbol: string
    amount: bigint
  }[]
  tvl: number
  apy: number
  rewards: {
    chain: number
    symbol: string
    amount: bigint
    date: number
    hash?: string
  }[]
  createdAt: Date
  updatedAt: Date
}

// Wallet Holding schema
const WalletHoldingSchema: Schema = new Schema(
  {
    wallet: {
      type: String,
      required: true,
    },
    borrows: {
      type: [
        {
          chain: {
            type: Number,
            required: true,
          },
          symbol: {
            type: String,
            required: true,
          },
          amount: {
            type: BigInt,
            required: true,
          },
        },
      ],
      default: [],
    },
    deposits: {
      type: [
        {
          chain: {
            type: Number,
            required: true,
          },
          symbol: {
            type: String,
            required: true,
          },
          amount: {
            type: BigInt,
            required: true,
          },
        },
      ],
      default: [],
    },
    tvl: {
      type: Number,
      default: 0,
    },
    apy: {
      type: Number,
      default: 0,
    },
    rewards: {
      type: [
        {
          chain: {
            type: Number,
            required: true,
          },
          symbol: {
            type: String,
            required: true,
          },
          amount: {
            type: BigInt,
            required: true,
          },
          date: {
            type: Number,
          },
          hash: {
            type: String,
          },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
)

export default mongoose.model<IWalletHolding>(
  "WalletHolding",
  WalletHoldingSchema
)
