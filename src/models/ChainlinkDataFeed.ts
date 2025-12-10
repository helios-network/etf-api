import mongoose, { Schema, Document } from "mongoose"

export interface Oracle {
  operator: string
}

export interface Docs {
  assetClass?: string
  assetSubClass?: string
  assetName?: string
  attributeType?: string
  baseAsset?: string
  baseAssetClic?: string
  baseAssetEntityId?: string
  blockchainName?: string
  clicProductName?: string
  deliveryChannelCode?: string
  feedCategory?: string
  feedType?: string
  hidden?: boolean
  marketHours?: string
  productSubType?: string
  productType?: string
  productTypeCode?: string
  quoteAsset?: string
  quoteAssetClic?: string
  quoteAssetEntityId?: string
  serviceLevel?: string
  shutdownDate?: string
  underlyingAsset?: string
  underlyingAssetClic?: string
}

export interface IChainlinkDataFeed extends Document {
  compareOffchain: string
  contractAddress: string
  contractType: string
  contractVersion: number
  decimalPlaces: number | null
  ens: string | null
  formatDecimalPlaces: number | null
  healthPrice: string
  history: boolean | null
  multiply: string
  name: string
  pair: string[]
  path: string
  proxyAddress: string | null
  threshold: number
  valuePrefix: string
  assetName: string
  feedCategory: string
  feedType: string
  docs: Docs
  decimals: number
  feedId: string | null
  sourceChain: number
  status: string
  oracles: Oracle[]
  heartbeat?: number
  createdAt: Date
  updatedAt: Date
}

// ChainlinkDataFeed schema
const ChainlinkDataFeedSchema: Schema = new Schema(
  {
    compareOffchain: {
      type: String,
      default: "",
    },
    contractAddress: {
      type: String,
      default: "",
    },
    contractType: {
      type: String,
      default: "",
    },
    contractVersion: {
      type: Number,
      default: 0,
    },
    decimalPlaces: {
      type: Number,
      default: null,
    },
    ens: {
      type: String,
      default: null,
    },
    formatDecimalPlaces: {
      type: Number,
      default: null,
    },
    healthPrice: {
      type: String,
      default: "",
    },
    history: {
      type: Boolean,
      default: null,
    },
    multiply: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      default: "",
    },
    pair: {
      type: [String],
      default: [],
    },
    path: {
      type: String,
      default: "",
    },
    proxyAddress: {
      type: String,
      default: null,
    },
    threshold: {
      type: Number,
      default: 0,
    },
    valuePrefix: {
      type: String,
      default: "",
    },
    assetName: {
      type: String,
      default: "",
    },
    feedCategory: {
      type: String,
      default: "",
    },
    feedType: {
      type: String,
      default: "",
    },
    docs: {
      type: Schema.Types.Mixed,
      default: {},
    },
    decimals: {
      type: Number,
      default: 0,
    },
    feedId: {
      type: String,
      default: null,
    },
    sourceChain: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      default: "",
    },
    oracles: {
      type: [
        {
          operator: {
            type: String,
            required: true,
          },
        },
      ],
      default: [],
    },
    heartbeat: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
)

// Create compound index for feedId and sourceChain to ensure uniqueness
// If feedId exists, it must be unique
ChainlinkDataFeedSchema.index({ feedId: 1 }, { unique: true, sparse: true })
// For feeds without feedId, use path + sourceChain as unique identifier
ChainlinkDataFeedSchema.index({ path: 1, sourceChain: 1 }, { unique: true, sparse: true })

export default mongoose.model<IChainlinkDataFeed>(
  "ChainlinkDataFeed",
  ChainlinkDataFeedSchema
)

