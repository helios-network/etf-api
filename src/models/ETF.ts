import mongoose, { Schema, Document } from "mongoose"

export interface AssetConfig {
  token: string
  feed: string
  targetWeightBps: number
  depositPath: string[]
  withdrawPath: string[]
  symbol?: string
  decimals?: number
  tvl?: string
}

export interface IETF extends Document {
  vault: string
  chain: number
  shareToken: string
  depositToken: string
  name: string
  symbol: string
  tvl: string
  volumeTradedUSD: string
  sharePrice?: string
  eventNonce: bigint
  eventHeight: bigint
  etfNonce: bigint
  factory?: string
  depositFeed?: string
  assets?: AssetConfig[]
  imbalanceThresholdBps?: bigint
  depositSymbol?: string
  depositDecimals?: number
  shareDecimals?: number
  createdAt: Date
  updatedAt: Date
}

// ETF schema
const ETFSchema: Schema = new Schema(
  {
    vault: {
      type: String,
      required: true,
      unique: true,
    },
    chain: {
      type: Number,
      required: true,
    },
    shareToken: {
      type: String,
      required: true,
    },
    depositToken: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    symbol: {
      type: String,
      required: true,
    },
    tvl: {
      type: String,
      default: "0",
    },
    sharePrice: {
      type: String,
    },
    eventNonce: {
      type: BigInt,
      required: true,
    },
    eventHeight: {
      type: BigInt,
      required: true,
    },
    etfNonce: {
      type: BigInt,
      required: true,
    },
    factory: {
      type: String,
    },
    depositFeed: {
      type: String,
    },
    volumeTradedUSD: {
      type: String,
      default: "0",
    },
    assets: {
      type: [
        {
          token: {
            type: String,
            required: true,
          },
          // feed: {
          //   type: String,
          //   required: true,
          // },
          targetWeightBps: {
            type: Number,
            required: true,
          },
          // depositPath: {
          //   type: [String],
          //   default: [],
          // },
          // withdrawPath: {
          //   type: [String],
          //   default: [],
          // },
          symbol: {
            type: String,
          },
          decimals: {
            type: Number,
          },
          tvl: {
            type: String,
          },
        },
      ],
      default: [],
    },
    imbalanceThresholdBps: {
      type: BigInt,
    },
    depositSymbol: {
      type: String,
    },
    depositDecimals: {
      type: Number,
    },
    shareDecimals: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
)

export default mongoose.model<IETF>("ETF", ETFSchema)

