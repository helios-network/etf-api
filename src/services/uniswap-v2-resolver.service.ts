import { Injectable, Logger } from '@nestjs/common';
import { parseAbi, formatUnits } from 'viem';
import {
  ASSETS_ADDRS,
  UNISWAP_V2_FACTORY_ADDRS,
  UNISWAP_V2_ROUTER_ADDRS,
  MIN_LIQUIDITY_USD,
} from '../constants';
import { V2PoolInfo } from '../types/etf-verify.types';
import { RpcClientService } from './rpc-client/rpc-client.service';
import { ChainId } from '../config/web3';
import {
  PoolResolver,
  PathCandidate,
  PathMetadata,
  AmmPathfinderService,
} from './amm-pathfinder.service';

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

/**
 * Uniswap V2 Pool Resolver implementing the shared PoolResolver interface.
 * Path type is string[] (array of token addresses).
 */
@Injectable()
export class UniswapV2ResolverService implements PoolResolver<string[]> {
  private readonly logger = new Logger(UniswapV2ResolverService.name);
  private readonly pathfinder = new AmmPathfinderService();

  // Cache for path results (stable keys, no price dependencies)
  private pathCache = new Map<string, V2PoolInfo>();
  // Cache for liquidity calculations (TTL: 30-120s in production, but we use simple Map for now)
  private liquidityCache = new Map<string, { value: number; timestamp: number }>();
  private readonly LIQUIDITY_CACHE_TTL_MS = 60000; // 60 seconds

  constructor(private readonly rpcClientService: RpcClientService) {}

  resetCache() {
    this.pathCache.clear();
    this.liquidityCache.clear();
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

      // Calculate USD value using formatUnits to safely convert bigint to number
      // If we have prices, use them directly
      if (tokenAPriceUSD && tokenBPriceUSD) {
        const amountA = Number(formatUnits(reserveA, tokenADecimals));
        const amountB = Number(formatUnits(reserveB, tokenBDecimals));
        const valueA = amountA * tokenAPriceUSD;
        const valueB = amountB * tokenBPriceUSD;
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
        const amountInFormatted = Number(formatUnits(amountIn, tokenADecimals));
        const amountOutFormatted = Number(formatUnits(amountOut, tokenBDecimals));
        const priceRatio = amountOutFormatted / amountInFormatted;

        // If we have price for tokenB, calculate liquidity
        if (tokenBPriceUSD) {
          const amountA = Number(formatUnits(reserveA, tokenADecimals));
          const amountB = Number(formatUnits(reserveB, tokenBDecimals));
          const valueA = amountA * priceRatio * tokenBPriceUSD;
          const valueB = amountB * tokenBPriceUSD;
          return valueA + valueB;
        }

        // If we have price for tokenA
        if (tokenAPriceUSD) {
          const amountA = Number(formatUnits(reserveA, tokenADecimals));
          const amountB = Number(formatUnits(reserveB, tokenBDecimals));
          const valueA = amountA * tokenAPriceUSD;
          const valueB = (amountB / priceRatio) * tokenAPriceUSD;
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
      const amountIn = 10n ** BigInt(WETH_DECIMALS); // 1 WETH
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
      // Convert to USD price using formatUnits for safe bigint conversion
      const wethPriceUSD = Number(formatUnits(amountOut, USDC_DECIMALS));

      return wethPriceUSD;
    } catch (error) {
      this.logger.error('Error getting WETH price in USDC:', error);
      return null;
    }
  }

  /**
   * PoolResolver interface implementation: find direct path between tokenA and tokenB.
   */
  async direct(meta: PathMetadata): Promise<PathCandidate<string[]>> {
    const liquidity = await this.calculateV2LiquidityUSD(
      meta.chainId,
      meta.tokenA,
      meta.tokenB,
      meta.tokenADecimals,
      meta.tokenBDecimals,
      meta.tokenAPriceUSD,
      meta.tokenBPriceUSD,
    );

    if (liquidity > 0) {
      return {
        exists: true,
        liquidityUSD: liquidity,
        path: [meta.tokenA, meta.tokenB],
      };
    }

    return {
      exists: false,
      liquidityUSD: 0,
      path: [],
    };
  }

  /**
   * PoolResolver interface implementation: find 2-hop path via intermediate token.
   */
  async via(
    meta: PathMetadata,
    midToken: `0x${string}`,
    midDecimals: number,
    midPriceUSD: number | null,
  ): Promise<PathCandidate<string[]>> {
    // Calculate liquidity for first hop: tokenA -> midToken
    const liquidityAtoMid = await this.calculateV2LiquidityUSD(
      meta.chainId,
      meta.tokenA,
      midToken,
      meta.tokenADecimals,
      midDecimals,
      meta.tokenAPriceUSD,
      midPriceUSD,
    );

    // Estimate midToken price if not provided (needed for second hop)
    let effectiveMidPrice = midPriceUSD;
    if (!effectiveMidPrice || effectiveMidPrice === 0) {
      // Try to get WETH price if midToken is WETH
      if (midToken.toLowerCase() === ASSETS_ADDRS[meta.chainId]?.WETH?.toLowerCase()) {
        effectiveMidPrice = await this.getWETHPriceInUSDC(meta.chainId);
      }
      // If still no price, use a fallback (1 USD) to allow calculation
      if (!effectiveMidPrice || effectiveMidPrice === 0) {
        effectiveMidPrice = meta.tokenAPriceUSD || 1;
      }
    }

    // Calculate liquidity for second hop: midToken -> tokenB
    const liquidityMidToB = await this.calculateV2LiquidityUSD(
      meta.chainId,
      midToken,
      meta.tokenB,
      midDecimals,
      meta.tokenBDecimals,
      effectiveMidPrice,
      meta.tokenBPriceUSD,
    );

    // Take minimum liquidity of the path (bottleneck)
    const pathLiquidity = Math.min(liquidityAtoMid, liquidityMidToB);

    if (pathLiquidity > 0) {
      return {
        exists: true,
        liquidityUSD: pathLiquidity,
        path: [meta.tokenA, midToken, meta.tokenB],
      };
    }

    return {
      exists: false,
      liquidityUSD: 0,
      path: [],
    };
  }

  /**
   * Public method: Find V2 path using the shared pathfinder algorithm.
   * Maintains backward compatibility with existing code.
   */
  async findV2Path(
    chainId: number,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    depositTokenDecimals: number,
    targetTokenDecimals: number,
    depositTokenPriceUSD: number | null,
    targetTokenPriceUSD: number | null,
  ): Promise<V2PoolInfo> {
    // Use stable cache key (no price dependencies, no decimals - they're just for calculation)
    // Normalize token addresses to ensure consistent ordering
    const [tokenA, tokenB] = [depositToken, targetToken].map((t) =>
      t.toLowerCase(),
    );
    const cacheKey = `v2-${chainId}-${tokenA < tokenB ? `${tokenA}-${tokenB}` : `${tokenB}-${tokenA}`}`;

    // Check cache
    if (this.pathCache.has(cacheKey)) {
      return this.pathCache.get(cacheKey)!;
    }

    // Use shared pathfinder algorithm
    const meta: PathMetadata = {
      chainId,
      tokenA: depositToken,
      tokenB: targetToken,
      tokenADecimals: depositTokenDecimals,
      tokenBDecimals: targetTokenDecimals,
      tokenAPriceUSD: depositTokenPriceUSD,
      tokenBPriceUSD: targetTokenPriceUSD,
    };

    const result = await this.pathfinder.bestPath(
      this,
      meta,
      MIN_LIQUIDITY_USD,
    );

    const pathInfo: V2PoolInfo = result
      ? {
          exists: true,
          liquidityUSD: result.liquidityUSD,
          path: result.path,
        }
      : {
          exists: false,
          liquidityUSD: 0,
          path: [],
        };

    // Cache the result
    this.pathCache.set(cacheKey, pathInfo);
    return pathInfo;
  }

  /**
   * Legacy method kept for backward compatibility.
   * @deprecated Use findV2Path instead, which now uses the shared pathfinder.
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
    // Delegate to findV2Path (which handles caching internally)
    return this.findV2Path(
      chainId,
      depositToken,
      targetToken,
      depositTokenDecimals,
      targetTokenDecimals,
      depositTokenPriceUSD,
      targetTokenPriceUSD,
    );
  }
}
