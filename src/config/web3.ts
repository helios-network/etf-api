import {
  createPublicClient,
  http,
  type PublicClient,
  createWalletClient,
  WalletClient,
} from "viem"
import { mainnet, bsc } from "viem/chains"

export enum ChainId {
  MAINNET = 1,
  BSC = 56,
}

export const DEFAULT_RPC_URLS = {
  [ChainId.MAINNET]: "https://ethereum-rpc.publicnode.com",
  [ChainId.BSC]: "https://bsc-rpc.publicnode.com",
}

export const publicClients: Record<ChainId, PublicClient> = {
  [ChainId.MAINNET]: createPublicClient({
    chain: mainnet,
    transport: http(DEFAULT_RPC_URLS[ChainId.MAINNET]),
  }),
  [ChainId.BSC]: createPublicClient({
    chain: bsc,
    transport: http(DEFAULT_RPC_URLS[ChainId.BSC]),
  }),
}

export const walletClients: Record<ChainId, WalletClient> = {
  [ChainId.MAINNET]: createWalletClient({
    chain: mainnet,
    transport: http(DEFAULT_RPC_URLS[ChainId.MAINNET]),
  }),
  [ChainId.BSC]: createWalletClient({
    chain: bsc,
    transport: http(DEFAULT_RPC_URLS[ChainId.BSC]),
  }),
}

export const GET_LOGS_BLOCKS = {
  [ChainId.MAINNET]: 1000n,
  [ChainId.BSC]: 1000n,
}
