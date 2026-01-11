import { Injectable, Logger } from '@nestjs/common';
import { parseAbi, encodeAbiParameters } from 'viem';
import {
  ASSETS_ADDRS,
  UNISWAP_V2_FACTORY_ADDRS,
  UNISWAP_V2_ROUTER_ADDRS,
} from '../constants';
import { V2PoolInfo } from '../types/etf-verify.types';
import { RpcClientService } from './rpc-client/rpc-client.service';
import { ChainId } from '../config/web3';

/**
 * Uniswap V2 Factory ABI
 */
const V2_FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
]);

/**
 * Uniswap V2 Pair ABI
 */
const V2_PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
]);

/**
 * Uniswap V2 Router ABI
 */
const V2_ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)',
]);

@Injectable()
export class UniswapV2ResolverService {
  private readonly logger = new Logger(UniswapV2ResolverService.name);

  private pathCache = new Map<string, V2PoolInfo>();

  constructor(private readonly rpcClientService: RpcClientService) {}

  resetCache() {
    this.pathCache.clear();
  }
  /**
   * Check if a V2 pool exists between two tokens
   */
  async checkV2Pool(
    chainId: number,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
  ): Promise<{ exists: boolean; pairAddress: `0x${string}` | null }> {
    try {
      const pairAddress = await this.rpcClientService.execute(
        chainId as ChainId,
        (client) =>
          client.readContract({
            address: UNISWAP_V2_FACTORY_ADDRS[chainId] as `0x${string}`,
            abi: V2_FACTORY_ABI,
            functionName: 'getPair',
            args: [tokenA, tokenB],
          }),
      );

      if (
        pairAddress &&
        pairAddress !== '0x0000000000000000000000000000000000000000'
      ) {
        return { exists: true, pairAddress: pairAddress as `0x${string}` };
      }

      return { exists: false, pairAddress: null };
    } catch (error) {
      this.logger.debug(
        `Error checking V2 pool for ${tokenA}/${tokenB}:`,
        error,
      );
      return { exists: false, pairAddress: null };
    }
  }

  /**
   * Get reserves from a V2 pair
   */
  async getV2Reserves(
    pairAddress: `0x${string}`,
    chainId: number,
  ): Promise<{ reserve0: bigint; reserve1: bigint } | null> {
    try {
      const [reserve0, reserve1] = await this.rpcClientService.execute(
        chainId as ChainId,
        (client) =>
          client.readContract({
            address: pairAddress,
            abi: V2_PAIR_ABI,
            functionName: 'getReserves',
          }),
      );

      return {
        reserve0: reserve0 as bigint,
        reserve1: reserve1 as bigint,
      };
    } catch (error) {
      this.logger.debug(`Error getting V2 reserves for ${pairAddress}:`, error);
      return null;
    }
  }

  /**
   * Calculate liquidity in USD for a V2 pool
   * Uses a quote from the router to estimate USD value
   */
  async calculateV2LiquidityUSD(
    chainId: number,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
    tokenADecimals: number,
    tokenBDecimals: number,
    tokenAPriceUSD: number | null, // Price from Chainlink feed if available
    tokenBPriceUSD: number | null,
  ): Promise<number> {
    try {
      const { exists, pairAddress } = await this.checkV2Pool(
        chainId,
        tokenA,
        tokenB,
      );
      if (!exists || !pairAddress) {
        return 0;
      }

      const reserves = await this.getV2Reserves(pairAddress, chainId);

      if (!reserves) {
        return 0;
      }

      // Get token0 and token1 to determine order
      const [token0, token1] = await Promise.all([
        this.rpcClientService.execute(chainId as ChainId, (client) =>
          client.readContract({
            address: pairAddress,
            abi: V2_PAIR_ABI,
            functionName: 'token0',
          }),
        ),
        this.rpcClientService.execute(chainId as ChainId, (client) =>
          client.readContract({
            address: pairAddress,
            abi: V2_PAIR_ABI,
            functionName: 'token1',
          }),
        ),
      ]);

      const isTokenAFirst =
        (token0 as string).toLowerCase() === tokenA.toLowerCase();
      const reserveA = isTokenAFirst ? reserves.reserve0 : reserves.reserve1;
      const reserveB = isTokenAFirst ? reserves.reserve1 : reserves.reserve0;

      // Calculate USD value
      // If we have prices, use them directly
      if (tokenAPriceUSD && tokenBPriceUSD) {
        const valueA =
          (Number(reserveA) / 10 ** tokenADecimals) * tokenAPriceUSD;
        const valueB =
          (Number(reserveB) / 10 ** tokenBDecimals) * tokenBPriceUSD;
        return valueA + valueB;
      }

      // Otherwise, use router to quote a swap and estimate
      // Quote swapping 1 tokenA to tokenB, then estimate USD
      const amountIn = 10n ** BigInt(tokenADecimals); // 1 token
      try {
        const amountsOut = await this.rpcClientService.execute(
          chainId as ChainId,
          (client) =>
            client.readContract({
              address: UNISWAP_V2_ROUTER_ADDRS[chainId] as `0x${string}`,
              abi: V2_ROUTER_ABI,
              functionName: 'getAmountsOut',
              args: [amountIn, [tokenA, tokenB]],
            }),
        );

        const amountOut = amountsOut[1] as bigint;
        const priceRatio =
          (Number(amountOut) / Number(amountIn)) *
          (10 ** tokenADecimals / 10 ** tokenBDecimals);

        // If we have price for tokenB, calculate liquidity
        if (tokenBPriceUSD) {
          const valueA =
            (Number(reserveA) / 10 ** tokenADecimals) *
            priceRatio *
            tokenBPriceUSD;
          const valueB =
            (Number(reserveB) / 10 ** tokenBDecimals) * tokenBPriceUSD;
          return valueA + valueB;
        }

        // If we have price for tokenA
        if (tokenAPriceUSD) {
          const valueA =
            (Number(reserveA) / 10 ** tokenADecimals) * tokenAPriceUSD;
          const valueB =
            (Number(reserveB) / 10 ** tokenBDecimals / priceRatio) *
            tokenAPriceUSD;
          return valueA + valueB;
        }

        // No prices available, return 0 (shouldn't happen in normal flow)
        return 0;
      } catch (error) {
        this.logger.debug(`Error quoting V2 swap:`, error);
        return 0;
      }
    } catch (error) {
      this.logger.debug(`Error calculating V2 liquidity:`, error);
      return 0;
    }
  }

  /**
   * Get WETH price in USDC using Uniswap V2
   * This is used when targetTokenPriceUSD is null or 0
   */
  async getWETHPriceInUSDC(chainId: number): Promise<number | null> {
    try {
      const WETH = ASSETS_ADDRS[chainId].WETH as `0x${string}`;
      const USDC = ASSETS_ADDRS[chainId].USDC as `0x${string}`;
      const WETH_DECIMALS = 18;
      const USDC_DECIMALS = 6;

      // Check if WETH/USDC pool exists
      const { exists } = await this.checkV2Pool(chainId, WETH, USDC);
      if (!exists) {
        this.logger.warn('WETH/USDC pool does not exist on Uniswap V2');
        return null;
      }

      // Quote 1 WETH in USDC
      const amountIn = BigInt(10 ** WETH_DECIMALS); // 1 WETH
      const amountsOut = await this.rpcClientService.execute(
        chainId as ChainId,
        (client) =>
          client.readContract({
            address: UNISWAP_V2_ROUTER_ADDRS[chainId] as `0x${string}`,
            abi: V2_ROUTER_ABI,
            functionName: 'getAmountsOut',
            args: [amountIn, [WETH, USDC]],
          }),
      );

      const amountOut = amountsOut[1] as bigint;
      // Convert to USD price: amountOut is in USDC (6 decimals), so divide by 10^6
      const wethPriceUSD = Number(amountOut) / 10 ** USDC_DECIMALS;

      return wethPriceUSD;
    } catch (error) {
      this.logger.error('Error getting WETH price in USDC:', error);
      return null;
    }
  }

  async findV2Path(
    chainId: number,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    depositTokenDecimals: number,
    targetTokenDecimals: number,
    depositTokenPriceUSD: number | null,
    targetTokenPriceUSD: number | null,
  ): Promise<V2PoolInfo> {
    const cacheKey = `${chainId}-${depositToken}-${targetToken}-${depositTokenDecimals}-${targetTokenDecimals}-${depositTokenPriceUSD}-${targetTokenPriceUSD}`;
    if (this.pathCache.has(cacheKey)) {
      return this.pathCache.get(cacheKey)!;
    }

    const path = await this.findV2PathUncached(
      chainId,
      depositToken,
      targetToken,
      depositTokenDecimals,
      targetTokenDecimals,
      depositTokenPriceUSD,
      targetTokenPriceUSD,
    );
    this.pathCache.set(cacheKey, path);
    return path;
  }

  /**
   * Find V2 path from depositToken to targetToken (1 or 2 hops max)
   */
  async findV2PathUncached(
    chainId: number,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    depositTokenDecimals: number,
    targetTokenDecimals: number,
    depositTokenPriceUSD: number | null,
    targetTokenPriceUSD: number | null,
  ): Promise<V2PoolInfo> {
    // Try direct path first
    const directLiquidity = await this.calculateV2LiquidityUSD(
      chainId,
      depositToken,
      targetToken,
      depositTokenDecimals,
      targetTokenDecimals,
      depositTokenPriceUSD,
      targetTokenPriceUSD,
    );

    if (directLiquidity >= 1000) {
      return {
        exists: true,
        liquidityUSD: directLiquidity,
        path: [depositToken, targetToken],
      };
    }

    // Try 2-hop path via WETH (most common intermediate token on Ethereum)
    const WETH = ASSETS_ADDRS[chainId].WETH as `0x${string}`;

    let depositPrice = depositTokenPriceUSD;
    if (!depositPrice || depositPrice === 0) {
      depositPrice = 1;
    }
    // Check depositToken -> WETH
    const depositToWethLiquidity = await this.calculateV2LiquidityUSD(
      chainId,
      depositToken,
      WETH,
      depositTokenDecimals,
      18, // WETH decimals
      depositPrice,
      null, // WETH price (we'll estimate)
    );

    // Get WETH price in USDC using Uniswap V2 (needed when targetTokenPriceUSD is null or 0)
    let wethPrice: number | null = null;
    if (!targetTokenPriceUSD || targetTokenPriceUSD === 0) {
      wethPrice = await this.getWETHPriceInUSDC(chainId);
      if (!wethPrice) {
        this.logger.warn(
          'Could not get WETH price in USDC, cannot calculate liquidity for WETH -> targetToken path',
        );
      }
    }

    // Check WETH -> targetToken
    const wethToTargetLiquidity = await this.calculateV2LiquidityUSD(
      chainId,
      WETH,
      targetToken,
      18, // WETH decimals
      targetTokenDecimals,
      wethPrice, // WETH price in USDC
      targetTokenPriceUSD,
    );

    // Take minimum liquidity of the path
    const twoHopLiquidity = Math.min(
      depositToWethLiquidity,
      wethToTargetLiquidity,
    );

    if (twoHopLiquidity >= 1000) {
      return {
        exists: true,
        liquidityUSD: twoHopLiquidity,
        path: [depositToken, WETH, targetToken],
      };
    }

    return {
      exists: false,
      liquidityUSD: 0,
      path: [],
    };
  }
}
