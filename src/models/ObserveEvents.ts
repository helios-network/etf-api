import mongoose, { Schema, Document } from "mongoose"

export interface IObserveEvents extends Document {
  chain: number
  lastBlockNumber: bigint
  lastNonce: bigint
  createdAt: Date
  updatedAt: Date
}

// ObserveEvents schema
const ObserveEventsSchema: Schema = new Schema(
  {
    chain: {
      type: Number,
      required: true,
      unique: true,
    },
    lastBlockNumber: {
      type: BigInt,
      required: true,
    },
    lastNonce: {
      type: BigInt,
      required: true,
    },
  },
  {
    timestamps: true,
  }
)

export default mongoose.model<IObserveEvents>("ObserveEvents", ObserveEventsSchema)

