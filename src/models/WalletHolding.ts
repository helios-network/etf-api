import mongoose, { Schema, Document } from "mongoose"

export interface IWalletHolding extends Document {
  wallet: string
  deposits: {
    chain: number
    symbol: string
    decimals: number
    etfVaultAddress: string
    etfTokenAddress: string
    amount: bigint
  }[]
  tvl: number
  rewards: {
    chain: number
    symbol: string
    amount: bigint
    date: number
    hash?: string
  }[]
  transactionsPerformed: number
  volumeTraded: string
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
          decimals: {
            type: Number,
            required: true,
          },
          etfVaultAddress: {
            type: String,
            required: true,
          },
          etfTokenAddress: {
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
    transactionsPerformed: {
      type: Number,
      default: 0,
    },
    volumeTraded: {
      type: BigInt,
      default: 0n,
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
