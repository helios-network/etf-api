import {
  createPublicClient,
  http,
  type PublicClient,
  createWalletClient,
  WalletClient,
} from "viem"
import { mainnet, arbitrum } from "viem/chains"

export enum ChainId {
  MAINNET = 1,
  ARBITRUM = 42161,
}

export const DEFAULT_RPC_URLS = {
  [ChainId.MAINNET]: "https://ethereum-rpc.publicnode.com",
  [ChainId.ARBITRUM]: "https://arbitrum-rpc.publicnode.com",
}

export const publicClients: Record<ChainId, PublicClient> = {
  [ChainId.MAINNET]: createPublicClient({
    chain: mainnet,
    transport: http(DEFAULT_RPC_URLS[ChainId.MAINNET]),
  }),
  [ChainId.ARBITRUM]: createPublicClient({
    chain: arbitrum,
    transport: http(DEFAULT_RPC_URLS[ChainId.MAINNET]),
  }),
}

export const walletClients: Record<ChainId, WalletClient> = {
  [ChainId.MAINNET]: createWalletClient({
    chain: mainnet,
    transport: http(DEFAULT_RPC_URLS[ChainId.MAINNET]),
  }),
  [ChainId.ARBITRUM]: createWalletClient({
    chain: arbitrum,
    transport: http(DEFAULT_RPC_URLS[ChainId.ARBITRUM]),
  }),
}

export const GET_LOGS_BLOCKS = {
  [ChainId.MAINNET]: 1000n,
  [ChainId.ARBITRUM]: 1000n,
}
