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
  [ChainId.MAINNET]: "0xbCa3dCabC5DEe8C209d50f3c7B132e46B217ba8a",
  [ChainId.ARBITRUM]: "0x0000000000000000000000000000000000000000",
}

export const DEFAULT_START_BLOCKS = {
  [ChainId.MAINNET]: 24016032n,
  [ChainId.ARBITRUM]: 0n,
}

// Uniswap V2 addresses (Ethereum Mainnet)
export const UNISWAP_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
export const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"

// Uniswap V3 addresses (Ethereum Mainnet)
export const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984"
export const UNISWAP_V3_QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
export const UNISWAP_V3_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564"

// Uniswap V3 pool fees (in basis points)
export const UNISWAP_V3_FEES = [100, 500, 3000, 10000] // 0.01%, 0.05%, 0.3%, 1%

// Minimum liquidity threshold in USD
export const MIN_LIQUIDITY_USD = 1000
