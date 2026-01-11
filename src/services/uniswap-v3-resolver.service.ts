import { Injectable, Logger } from '@nestjs/common';
import { parseAbi, encodePacked, formatUnits } from 'viem';
import {
  UNISWAP_V3_FACTORY_ADDRS,
  UNISWAP_V3_FEES,
  MIN_LIQUIDITY_USD,
  ASSETS_ADDRS,
} from '../constants';
import { V3PoolInfo, V3PathInfo } from '../types/etf-verify.types';
import { RpcClientService } from './rpc-client/rpc-client.service';
import { ChainId } from '../config/web3';
import {
  PoolResolver,
  PathCandidate,
  PathMetadata,
  AmmPathfinderService,
} from './amm-pathfinder.service';

/**
 * Uniswap V3 Factory ABI
 */
const V3_FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
]);

/**
 * Uniswap V3 Pool ABI
 */
const V3_POOL_ABI = parseAbi([
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
]);

/**
 * Uniswap V3 Quoter ABI
 */
const V3_QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)',
]);

/**
 * Uniswap V3 Pool Resolver implementing the shared PoolResolver interface.
 * Path type is V3PathInfo (contains fee tiers, isDirect flag, etc.).
 */
@Injectable()
export class UniswapV3ResolverService implements PoolResolver<V3PathInfo> {
  private readonly logger = new Logger(UniswapV3ResolverService.name);
  private readonly pathfinder = new AmmPathfinderService();

  // Cache for path results (stable keys, no price dependencies)
  private pathCache = new Map<string, V3PathInfo>();
  // Cache for liquidity calculations
  private liquidityCache = new Map<string, { value: number; timestamp: number }>();
  private readonly LIQUIDITY_CACHE_TTL_MS = 60000; // 60 seconds

  constructor(private readonly rpcClientService: RpcClientService) {}

  resetCache() {
    this.pathCache.clear();
    this.liquidityCache.clear();
  }
  /**
   * Check if a V3 pool exists for a given fee tier
   */
  async checkV3Pool(
    chainId: number,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
    fee: number,
  ): Promise<{ exists: boolean; poolAddress: `0x${string}` | null }> {
    try {
      const poolAddress = await this.rpcClientService.execute(
        chainId as ChainId,
        (client) =>
          client.readContract({
            address: UNISWAP_V3_FACTORY_ADDRS[chainId] as `0x${string}`,
            abi: V3_FACTORY_ABI,
            functionName: 'getPool',
            args: [tokenA, tokenB, fee],
          }),
      );

      if (
        poolAddress &&
        poolAddress !== '0x0000000000000000000000000000000000000000'
      ) {
        return { exists: true, poolAddress: poolAddress as `0x${string}` };
      }

      return { exists: false, poolAddress: null };
    } catch (error) {
      this.logger.debug(
        `Error checking V3 pool for ${tokenA}/${tokenB} fee ${fee}:`,
        error,
      );
      return { exists: false, poolAddress: null };
    }
  }

  /**
   * Get liquidity from a V3 pool
   */
  async getV3Liquidity(
    poolAddress: `0x${string}`,
    chainId: number,
  ): Promise<bigint | null> {
    try {
      const liquidity = await this.rpcClientService.execute(
        chainId as ChainId,
        (client) =>
          client.readContract({
            address: poolAddress,
            abi: V3_POOL_ABI,
            functionName: 'liquidity',
          }),
      );

      return liquidity as bigint;
    } catch (error) {
      this.logger.debug(
        `Error getting V3 liquidity for ${poolAddress}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Calculate liquidity in USD for a V3 pool
   * Uses quoter to estimate USD value
   */
  async calculateV3LiquidityUSD(
    chainId: number,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
    fee: number,
    tokenADecimals: number,
    tokenBDecimals: number,
    tokenAPriceUSD: number | null,
    tokenBPriceUSD: number | null,
  ): Promise<[number, string, number | null]> {
    try {
      const { exists, poolAddress } = await this.checkV3Pool(
        chainId,
        tokenA,
        tokenB,
        fee,
      );

      if (!exists || !poolAddress) {
        return [0, '', null];
      }

      // Read token0/token1 from pool
      const [token0, token1] = await Promise.all([
        this.rpcClientService.execute(
          chainId as ChainId,
          (client) =>
            client.readContract({
              address: poolAddress,
              abi: V3_POOL_ABI,
              functionName: 'token0',
            }) as Promise<`0x${string}`>,
        ),
        this.rpcClientService.execute(
          chainId as ChainId,
          (client) =>
            client.readContract({
              address: poolAddress,
              abi: V3_POOL_ABI,
              functionName: 'token1',
            }) as Promise<`0x${string}`>,
        ),
      ]);

      // Minimal ERC20 ABI
      const ERC20_ABI = parseAbi([
        'function balanceOf(address) view returns (uint256)',
      ]);

      // Read balances of token0/token1 held by pool
      const [balance0Raw, balance1Raw] = await Promise.all([
        this.rpcClientService.execute(
          chainId as ChainId,
          (client) =>
            client.readContract({
              address: token0,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [poolAddress],
            }) as Promise<bigint>,
        ),
        this.rpcClientService.execute(
          chainId as ChainId,
          (client) =>
            client.readContract({
              address: token1,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [poolAddress],
            }) as Promise<bigint>,
        ),
      ]);

      // Resolve decimals for token0/token1 using provided decimals for tokenA/tokenB
      const decimals0 =
        token0.toLowerCase() === tokenA.toLowerCase()
          ? tokenADecimals
          : tokenBDecimals;

      const decimals1 =
        token1.toLowerCase() === tokenA.toLowerCase()
          ? tokenADecimals
          : tokenBDecimals;

      // Convert balances safely using viem's formatUnits (consistent with V2)
      const amount0 = Number(formatUnits(balance0Raw, decimals0));
      const amount1 = Number(formatUnits(balance1Raw, decimals1));

      // Read slot0 to get tick
      const slot0 = await this.rpcClientService.execute(
        chainId as ChainId,
        (client) =>
          client.readContract({
            address: poolAddress,
            abi: V3_POOL_ABI,
            functionName: 'slot0',
          }),
      );

      // slot0: [sqrtPriceX96, tick, ...]
      const tick = Number(slot0[1]);

      // Uniswap V3 price from tick:
      // priceToken1PerToken0 = (1.0001^tick) * 10^(decimals0 - decimals1)
      const priceToken1PerToken0 =
        Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);

      // Determine mapping tokenA/tokenB to token0/token1
      const token0IsTokenA = token0.toLowerCase() === tokenA.toLowerCase();
      const token1IsTokenA = token1.toLowerCase() === tokenA.toLowerCase();

      let calculatedTokenBPriceUSD: number | null = null;

      // If both prices known: compute directly
      if (tokenAPriceUSD != null && tokenBPriceUSD != null) {
        const token0PriceUSD = token0IsTokenA ? tokenAPriceUSD : tokenBPriceUSD;
        const token1PriceUSD = token1IsTokenA ? tokenAPriceUSD : tokenBPriceUSD;

        const liquidityUSD =
          amount0 * token0PriceUSD + amount1 * token1PriceUSD;
        return [liquidityUSD, poolAddress, null];
      }

      // If only tokenA price known: infer tokenB price using pool price
      if (tokenAPriceUSD != null && tokenBPriceUSD == null) {
        // priceToken1PerToken0 tells: 1 token0 = priceToken1PerToken0 token1
        // So:
        // - if token0 == tokenA and token1 == tokenB: tokenBUSD = tokenAUSD / (tokenA per tokenB)
        //   but easier:
        //   token1USD = token0USD / (token1 per token0) ??? no:
        //   If 1 token0 = X token1, then token1 = 1/X token0
        //   => USD(token1) = USD(token0) / X
        //
        // - if token1 == tokenA and token0 == tokenB: tokenA is token1
        //   token0USD = token1USD * X
        //   => tokenB (token0) USD = tokenAUSD * X
        if (token0IsTokenA) {
          // tokenA == token0, tokenB == token1
          calculatedTokenBPriceUSD = tokenAPriceUSD / priceToken1PerToken0;
        } else {
          // tokenA == token1, tokenB == token0
          calculatedTokenBPriceUSD = tokenAPriceUSD * priceToken1PerToken0;
        }

        const token0PriceUSD = token0IsTokenA
          ? tokenAPriceUSD
          : calculatedTokenBPriceUSD;
        const token1PriceUSD = token1IsTokenA
          ? tokenAPriceUSD
          : calculatedTokenBPriceUSD;

        const liquidityUSD =
          amount0 * token0PriceUSD + amount1 * token1PriceUSD;
        return [liquidityUSD, poolAddress, calculatedTokenBPriceUSD];
      }

      // If only tokenB price known: infer tokenA price then compute liquidity, but we only return tokenB inferred (null here)
      if (tokenAPriceUSD == null && tokenBPriceUSD != null) {
        let calculatedTokenAPriceUSD: number;

        if (token0IsTokenA) {
          // tokenA == token0, tokenB == token1
          // token1USD = token0USD / X  => token0USD = token1USD * X
          calculatedTokenAPriceUSD = tokenBPriceUSD * priceToken1PerToken0;
        } else {
          // tokenA == token1, tokenB == token0
          // token0USD = token1USD * X  => token1USD = token0USD / X
          calculatedTokenAPriceUSD = tokenBPriceUSD / priceToken1PerToken0;
        }

        const token0PriceUSD = token0IsTokenA
          ? calculatedTokenAPriceUSD
          : tokenBPriceUSD;
        const token1PriceUSD = token1IsTokenA
          ? calculatedTokenAPriceUSD
          : tokenBPriceUSD;

        const liquidityUSD =
          amount0 * token0PriceUSD + amount1 * token1PriceUSD;
        return [liquidityUSD, poolAddress, null];
      }

      // No prices known
      return [0, poolAddress, null];
    } catch (err) {
      this.logger.debug('calculateV3LiquidityUSD error', err);
      return [0, '', null];
    }
  }

  /**
   * Find best V3 pool for a token pair
   * Tries all fee tiers and returns the one with highest liquidity
   */
  async findBestV3Pool(
    chainId: number,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
    tokenADecimals: number,
    tokenBDecimals: number,
    tokenAPriceUSD: number | null,
    tokenBPriceUSD: number | null,
  ): Promise<V3PoolInfo> {
    let bestPool: V3PoolInfo = {
      exists: false,
      fee: 0,
      liquidityUSD: 0,
      token0: tokenA,
      token1: tokenB,
      poolAddress: '',
      calculatedTokenBPriceUSD: null,
    };

    for (const fee of UNISWAP_V3_FEES) {
      const [liquidity, poolAddress, calculatedTokenBPriceUSD] =
        await this.calculateV3LiquidityUSD(
          chainId,
          tokenA,
          tokenB,
          fee,
          tokenADecimals,
          tokenBDecimals,
          tokenAPriceUSD,
          tokenBPriceUSD,
        );
      // Note: calculatedTokenBPriceUSD is returned but not used here

      this.logger.debug(
        `findBestV3Pool V3 liquidity for ${tokenA}/${tokenB} fee ${fee}: ${liquidity} ${poolAddress}`,
      );

      if (liquidity > bestPool.liquidityUSD) {
        bestPool = {
          exists: true,
          fee,
          liquidityUSD: liquidity,
          token0: tokenA,
          token1: tokenB,
          poolAddress,
          calculatedTokenBPriceUSD,
        };
      }
    }

    if (bestPool.liquidityUSD > 0) {
      this.logger.debug(
        `findBestV3Pool Best V3 pool for ${tokenA}/${tokenB} fee ${bestPool.fee} with liquidity ${bestPool.liquidityUSD} ${bestPool.poolAddress}`,
      );
    }

    return bestPool;
  }

  /**
   * PoolResolver interface implementation: find direct path between tokenA and tokenB.
   * Tries all fee tiers and returns the best one.
   */
  async direct(meta: PathMetadata): Promise<PathCandidate<V3PathInfo>> {
    const bestPool = await this.findBestV3Pool(
      meta.chainId,
      meta.tokenA,
      meta.tokenB,
      meta.tokenADecimals,
      meta.tokenBDecimals,
      meta.tokenAPriceUSD,
      meta.tokenBPriceUSD,
    );

    if (bestPool.exists && bestPool.liquidityUSD > 0) {
      return {
        exists: true,
        liquidityUSD: bestPool.liquidityUSD,
        path: {
          exists: true,
          liquidityUSD: bestPool.liquidityUSD,
          isDirect: true,
          fee: bestPool.fee,
          token0: bestPool.token0,
          token1: bestPool.token1,
        },
        metadata: {
          poolAddress: bestPool.poolAddress,
          calculatedTokenBPriceUSD: bestPool.calculatedTokenBPriceUSD,
        },
      };
    }

    return {
      exists: false,
      liquidityUSD: 0,
      path: {
        exists: false,
        liquidityUSD: 0,
        isDirect: false,
      },
    };
  }

  /**
   * PoolResolver interface implementation: find 2-hop path via intermediate token.
   * Tries all fee tiers for both hops and returns the best combination.
   */
  async via(
    meta: PathMetadata,
    midToken: `0x${string}`,
    midDecimals: number,
    midPriceUSD: number | null,
  ): Promise<PathCandidate<V3PathInfo>> {
    // Find best pool for first hop: tokenA -> midToken
    const poolAtoMid = await this.findBestV3Pool(
      meta.chainId,
      meta.tokenA,
      midToken,
      meta.tokenADecimals,
      midDecimals,
      meta.tokenAPriceUSD,
      midPriceUSD,
    );

    if (!poolAtoMid.exists) {
      return {
        exists: false,
        liquidityUSD: 0,
        path: {
          exists: false,
          liquidityUSD: 0,
          isDirect: false,
        },
      };
    }

    // Use calculated price from first hop if available, otherwise use provided price
    const effectiveMidPrice =
      poolAtoMid.calculatedTokenBPriceUSD || midPriceUSD;

    // Find best pool for second hop: midToken -> tokenB
    const poolMidToB = await this.findBestV3Pool(
      meta.chainId,
      midToken,
      meta.tokenB,
      midDecimals,
      meta.tokenBDecimals,
      effectiveMidPrice,
      meta.tokenBPriceUSD,
    );

    if (!poolMidToB.exists) {
      return {
        exists: false,
        liquidityUSD: 0,
        path: {
          exists: false,
          liquidityUSD: 0,
          isDirect: false,
        },
      };
    }

    // Take minimum liquidity of the path (bottleneck)
    const pathLiquidity = Math.min(
      poolAtoMid.liquidityUSD,
      poolMidToB.liquidityUSD,
    );

    if (pathLiquidity > 0) {
      return {
        exists: true,
        liquidityUSD: pathLiquidity,
        path: {
          exists: true,
          liquidityUSD: pathLiquidity,
          isDirect: false,
          depositToWethFee: poolAtoMid.fee,
          wethToTargetFee: poolMidToB.fee,
        },
        metadata: {
          poolAtoMidAddress: poolAtoMid.poolAddress,
          poolMidToBAddress: poolMidToB.poolAddress,
          calculatedMidPriceUSD: poolAtoMid.calculatedTokenBPriceUSD,
        },
      };
    }

    return {
      exists: false,
      liquidityUSD: 0,
      path: {
        exists: false,
        liquidityUSD: 0,
        isDirect: false,
      },
    };
  }

  /**
   * Public method: Find V3 path using the shared pathfinder algorithm.
   * Maintains backward compatibility with existing code.
   */
  async findV3Path(
    chainId: number,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    depositTokenDecimals: number,
    targetTokenDecimals: number,
    depositTokenPriceUSD: number | null,
    targetTokenPriceUSD: number | null,
  ): Promise<V3PathInfo> {
    // Use stable cache key (no price dependencies, no decimals - they're just for calculation)
    // Normalize token addresses to ensure consistent ordering
    const [tokenA, tokenB] = [depositToken, targetToken].map((t) =>
      t.toLowerCase(),
    );
    const cacheKey = `v3-${chainId}-${tokenA < tokenB ? `${tokenA}-${tokenB}` : `${tokenB}-${tokenA}`}`;

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

    const pathInfo: V3PathInfo = result
      ? result.path
      : {
          exists: false,
          liquidityUSD: 0,
          isDirect: false,
        };

    // Cache the result
    this.pathCache.set(cacheKey, pathInfo);
    return pathInfo;
  }

  /**
   * Legacy method kept for backward compatibility.
   * @deprecated Use findV3Path instead, which now uses the shared pathfinder.
   */
  async findV3PathUncached(
    chainId: number,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    depositTokenDecimals: number,
    targetTokenDecimals: number,
    depositTokenPriceUSD: number | null,
    targetTokenPriceUSD: number | null,
  ): Promise<V3PathInfo> {
    // Delegate to findV3Path (which handles caching internally)
    return this.findV3Path(
      chainId,
      depositToken,
      targetToken,
      depositTokenDecimals,
      targetTokenDecimals,
      depositTokenPriceUSD,
      targetTokenPriceUSD,
    );
  }

  /**
   * Encode V3 path for deposit/withdraw
   * Format for direct: token0 (20 bytes) + fee (3 bytes) + token1 (20 bytes)
   * Format for 2-hop: token0 (20 bytes) + fee (3 bytes) + token1 (20 bytes) + fee (3 bytes) + token2 (20 bytes)
   */
  encodeV3Path(
    token0: `0x${string}`,
    fee: number,
    token1: `0x${string}`,
    fee2?: number,
    token2?: `0x${string}`,
  ): string {
    if (fee2 !== undefined && token2 !== undefined) {
      // 2-hop path: token0 + fee + token1 + fee2 + token2
      return encodePacked(
        ['address', 'uint24', 'address', 'uint24', 'address'],
        [token0, fee, token1, fee2, token2],
      );
    }
    // Direct path: token0 + fee + token1
    return encodePacked(
      ['address', 'uint24', 'address'],
      [token0, fee, token1],
    );
  }
}
