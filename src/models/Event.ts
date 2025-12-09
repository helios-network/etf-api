import mongoose, { Schema, Document } from "mongoose"

export interface IEvent extends Document {
  type: string
  chain: number
  user?: string
  token?: string
  amount?: bigint
  nonce: bigint
  vault?: string
  depositAmount?: string
  sharesOut?: string
  sharesIn?: string
  depositOut?: string
  fromIndex?: string
  toIndex?: string
  moveValue?: string
  bought?: string
  imbalanceThresholdBps?: string
  maxPriceStaleness?: string
  eventHeight?: string
  etfNonce?: string
  etfHeight?: string
  shareToken?: string
  depositToken?: string
  name?: string
  symbol?: string
  createdAt: Date
  updatedAt: Date
  blockNumber: bigint
}

// Reward schema
const EventSchema: Schema = new Schema(
  {
    type: {
      type: String,
      enum: [
        "Deposit",
        "Redeem",
        "ETFCreated",
        "Rebalance",
        "ParamsUpdated",
      ],
      required: true,
    },
    chain: {
      type: Number,
      required: true,
    },
    user: {
      type: String,
      required: false,
    },
    token: {
      type: String,
    },
    amount: {
      type: BigInt,
    },
    nonce: {
      type: BigInt,
      required: true,
    },
    vault: {
      type: String,
    },
    depositAmount: {
      type: String,
    },
    sharesOut: {
      type: String,
    },
    sharesIn: {
      type: String,
    },
    depositOut: {
      type: String,
    },
    fromIndex: {
      type: String,
    },
    toIndex: {
      type: String,
    },
    moveValue: {
      type: String,
    },
    bought: {
      type: String,
    },
    imbalanceThresholdBps: {
      type: String,
    },
    maxPriceStaleness: {
      type: String,
    },
    eventHeight: {
      type: String,
    },
    etfNonce: {
      type: String,
    },
    etfHeight: {
      type: String,
    },
    shareToken: {
      type: String,
    },
    depositToken: {
      type: String,
    },
    name: {
      type: String,
    },
    symbol: {
      type: String,
    },
    blockNumber: {
      type: BigInt,
      required: true,
    },
  },
  {
    timestamps: true,
  }
)

export default mongoose.model<IEvent>("Event", EventSchema)
