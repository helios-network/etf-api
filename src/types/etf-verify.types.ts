/**
 * Types for ETF verification endpoint
 */

export type PricingMode = 'V2_PLUS_FEED' | 'V3_PLUS_FEED' | 'V2_PLUS_V2' | 'V3_PLUS_V3';

export interface VerifyRequest {
  chainId: number;
  depositToken: string;
  components: Array<{
    token: string;
    weight: number;
  }>;
}

export interface DepositPath {
  type: 'V2' | 'V3';
  encoded: string;
  path?: string[]; // For V2, the address array
  token0?: string; // For V3
  token1?: string; // For V3
  fee?: number; // For V3
}

export interface WithdrawPath {
  type: 'V2' | 'V3';
  encoded: string;
  path?: string[]; // For V2, the address array
  token0?: string; // For V3
  token1?: string; // For V3
  fee?: number; // For V3
}

export interface ComponentVerification {
  token: string;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  pricingMode: PricingMode;
  feed: string | null;
  depositPath: DepositPath;
  withdrawPath: WithdrawPath;
  liquidityUSD: number;
}

export interface VerifySuccessResponse {
  status: 'OK';
  readyForCreation: true;
  factoryAddress: string;
  components: ComponentVerification[];
}

export interface VerifyErrorResponse {
  status: 'ERROR';
  reason:
    | 'INSUFFICIENT_LIQUIDITY'
    | 'NO_POOL_FOUND'
    | 'NO_FEED_FOUND'
    | 'INVALID_INPUT'
    | 'INTERNAL_ERROR';
  details: {
    token: string;
    symbol?: string;
    requiredUSD?: number;
    foundUSD?: number;
    message?: string;
  };
}

export type VerifyResponse = VerifySuccessResponse | VerifyErrorResponse;

/**
 * Internal types for resolution process
 */
export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
}

export interface ChainlinkFeed {
  proxyAddress: string;
  path: string;
  pair: string[];
  decimals: number;
}

export interface V2PoolInfo {
  exists: boolean;
  liquidityUSD: number;
  path: string[]; // Direct path or multi-hop
}

export interface V3PoolInfo {
  exists: boolean;
  fee: number;
  liquidityUSD: number;
  token0: string;
  token1: string;
  poolAddress: string;
  calculatedTokenBPriceUSD: number | null;
}

export interface V3PathInfo {
  exists: boolean;
  liquidityUSD: number;
  isDirect: boolean; // true if direct pool, false if via WETH
  // For direct path
  fee?: number;
  token0?: string;
  token1?: string;
  // For 2-hop path via WETH
  depositToWethFee?: number;
  wethToTargetFee?: number;
}

export interface ResolutionResult {
  pricingMode: PricingMode;
  feed: ChainlinkFeed | null;
  depositPath: DepositPath;
  withdrawPath: WithdrawPath;
  liquidityUSD: number;
}
