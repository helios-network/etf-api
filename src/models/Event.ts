import mongoose, { Schema, Document } from "mongoose"

export interface IEvent extends Document {
  type: string
  chain: number
  user: string
  token?: string
  amount?: bigint
  nonce: bigint
  liquidator?: string
  collateralToken?: string
  collateralAmount?: bigint
  debtToken?: string
  debtRepaid?: bigint
  createdAt: Date
  updatedAt: Date
  blockNumber: bigint
}

// Reward schema
const EventSchema: Schema = new Schema(
  {
    type: {
      type: String,
      enum: ["Deposited", "Withdrawn", "Borrowed", "Repaid", "Liquidated"],
      required: true,
    },
    chain: {
      type: Number,
      required: true,
    },
    user: {
      type: String,
      required: true,
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
    liquidator: {
      type: String,
    },
    collateralToken: {
      type: String,
    },
    collateralAmount: {
      type: BigInt,
    },
    debtToken: {
      type: String,
    },
    debtRepaid: {
      type: BigInt,
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
