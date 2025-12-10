import { ChainId } from "../config/web3"

export const SUPPORTED_ASSETS = {
  [ChainId.MAINNET]: [
    {
      symbol: "HLS",
      decimals: 18,
      address: "0x970a341B4E311A5c7248Dc9c3d8d4f35fEdFA73e",
    },
    {
      symbol: "BNB",
      decimals: 18,
      address: "0xB8c77482e45F1F44dE1745F52C74426C631bDD52",
    },
    {
      symbol: "ETH",
      decimals: 18,
      address: "0x0000000000000000000000000000000000000000",
    },
    {
      symbol: "USDC",
      decimals: 6,
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
    {
      symbol: "USDT",
      decimals: 6,
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    },
  ],
  [ChainId.ARBITRUM]: [
    {
      symbol: "BNB",
      decimals: 18,
      address: "0x0000000000000000000000000000000000000000",
    },
    {
      symbol: "ETH",
      decimals: 18,
      address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    },
    {
      symbol: "USDC",
      decimals: 18,
      address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    },
    {
      symbol: "USDT",
      decimals: 18,
      address: "0x55d398326f99059fF775485246999027B3197955",
    },
  ],
}

export const ETF_CONTRACT_ADDRS = {
  [ChainId.MAINNET]: "0xC17A357ea99C6b6379eFD31A0638b7D88deb5699",
  [ChainId.ARBITRUM]: "0x0000000000000000000000000000000000000000",
}

export const DEFAULT_START_BLOCKS = {
  [ChainId.MAINNET]: 23972962n,
  [ChainId.ARBITRUM]: 0n,
}
