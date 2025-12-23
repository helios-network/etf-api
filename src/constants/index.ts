import { ChainId } from '../config/web3';

export const ASSETS_ADDRS = {
  [ChainId.MAINNET]: {
    HLS: '0x970a341B4E311A5c7248Dc9c3d8d4f35fEdFA73e',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum Mainnet
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  [ChainId.ARBITRUM]: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    HLS: '0x4267ac2b815664047855b6c64be5605af9d51304',
  },
};

export const AUTORIZED_DEPOSIT_TOKENS = {
  [ChainId.MAINNET]: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum Mainnet
  ],
  [ChainId.ARBITRUM]: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  ],
}

export const ETF_CONTRACT_ADDRS = {
  [ChainId.MAINNET]: '0x3EC2D623411B70beb9878A50A541775eE8e8034C',
  [ChainId.ARBITRUM]: '0xe36F7f59ce3b2377E5c7Ca2FF83c0b4e0a116e27',
};

export const DEFAULT_START_BLOCKS = {
  [ChainId.MAINNET]: BigInt(24072858),
  [ChainId.ARBITRUM]: BigInt(413542428),
};

// Uniswap V2 addresses (Ethereum Mainnet)
// https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments
export const UNISWAP_V2_FACTORY_ADDRS = {
  [ChainId.MAINNET]: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
  [ChainId.ARBITRUM]: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
};
export const UNISWAP_V2_ROUTER_ADDRS = {
  [ChainId.MAINNET]: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  [ChainId.ARBITRUM]: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
};

// Uniswap V3 addresses (Ethereum Mainnet)
// https://docs.uniswap.org/contracts/v3/reference/deployments/arbitrum-deployments
export const UNISWAP_V3_FACTORY_ADDRS = {
  [ChainId.MAINNET]: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  [ChainId.ARBITRUM]: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
};
export const UNISWAP_V3_QUOTER_ADDRS = {
  [ChainId.MAINNET]: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  [ChainId.ARBITRUM]: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
};
export const UNISWAP_V3_ROUTER_ADDRS = {
  [ChainId.MAINNET]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  [ChainId.ARBITRUM]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
};



// Uniswap V3 pool fees (in basis points)
export const UNISWAP_V3_FEES = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

// Minimum liquidity threshold in USD
export const MIN_LIQUIDITY_USD = 1000;
