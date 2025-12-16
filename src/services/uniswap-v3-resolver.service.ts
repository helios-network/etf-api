import { Injectable, Logger } from '@nestjs/common';
import { type PublicClient, parseAbi, encodePacked } from 'viem';
import {
  UNISWAP_V3_FACTORY_ADDRS,
  UNISWAP_V3_QUOTER_ADDRS,
  UNISWAP_V3_FEES,
  MIN_LIQUIDITY_USD,
  ASSETS_ADDRS,
} from '../constants';
import { V3PoolInfo, V3PathInfo } from '../types/etf-verify.types';

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

@Injectable()
export class UniswapV3ResolverService {
  private readonly logger = new Logger(UniswapV3ResolverService.name);
  /**
   * Check if a V3 pool exists for a given fee tier
   */
  async checkV3Pool(
    client: PublicClient,
    chainId: number,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
    fee: number,
  ): Promise<{ exists: boolean; poolAddress: `0x${string}` | null }> {
    try {
      const poolAddress = await client.readContract({
        address: UNISWAP_V3_FACTORY_ADDRS[chainId] as `0x${string}`,
        abi: V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [tokenA, tokenB, fee],
      });

      if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
        return { exists: true, poolAddress: poolAddress as `0x${string}` };
      }

      return { exists: false, poolAddress: null };
    } catch (error) {
      this.logger.debug(`Error checking V3 pool for ${tokenA}/${tokenB} fee ${fee}:`, error);
      return { exists: false, poolAddress: null };
    }
  }

  /**
   * Get liquidity from a V3 pool
   */
  async getV3Liquidity(
    client: PublicClient,
    poolAddress: `0x${string}`,
  ): Promise<bigint | null> {
    try {
      const liquidity = await client.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: 'liquidity',
      });

      return liquidity as bigint;
    } catch (error) {
      this.logger.debug(`Error getting V3 liquidity for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Calculate liquidity in USD for a V3 pool
   * Uses quoter to estimate USD value
   */
  async calculateV3LiquidityUSD(
    client: PublicClient,
    chainId: number,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
    fee: number,
    tokenADecimals: number,
    tokenBDecimals: number,
    tokenAPriceUSD: number | null,
    tokenBPriceUSD: number | null,
  ): Promise<number> {
    try {
      const { exists, poolAddress } = await this.checkV3Pool(client, chainId, tokenA, tokenB, fee);
      if (!exists || !poolAddress) {
        return 0;
      }

      const liquidity = await this.getV3Liquidity(client, poolAddress);
      if (!liquidity || liquidity === 0n) {
        return 0;
      }

      // Get slot0 to get current price
      const slot0 = await client.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: 'slot0',
      });

      const sqrtPriceX96 = slot0[0] as bigint;

      // Calculate price from sqrtPriceX96
      // price = (sqrtPriceX96 / 2^96)^2
      // Adjust for decimals: price = (sqrtPriceX96 / 2^96)^2 * (10^tokenADecimals / 10^tokenBDecimals)
      const Q96 = 2n ** 96n;
      const price = (sqrtPriceX96 * sqrtPriceX96) / (Q96 * Q96);
      const adjustedPrice = Number(price) * (10 ** tokenADecimals / 10 ** tokenBDecimals);

      // Estimate liquidity value
      // Use a quote to estimate USD value
      const amountIn = BigInt(10 ** tokenADecimals); // 1 token
      try {
        const amountOut = await client.readContract({
          address: UNISWAP_V3_QUOTER_ADDRS[chainId] as `0x${string}`,
          abi: V3_QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [tokenA, tokenB, fee, amountIn, 0n],
        });

        const priceRatio =
          (Number(amountOut) / Number(amountIn)) *
          (10 ** tokenADecimals / 10 ** tokenBDecimals);

        // Calculate actual token amounts from liquidity and price
        // In V3, liquidity is stored as sqrt(x * y), so we can estimate amounts
        const liquidityNum = Number(liquidity);
        const sqrtLiquidity = Math.sqrt(liquidityNum);

        // Estimate token amounts: if price is P, and L = sqrt(x * y), then:
        // x = L / sqrt(P), y = L * sqrt(P)
        // Adjust for decimals
        const sqrtPrice = Math.sqrt(priceRatio);
        const estimatedAmountA = sqrtLiquidity / sqrtPrice / 10 ** tokenADecimals;
        const estimatedAmountB = (sqrtLiquidity * sqrtPrice) / 10 ** tokenBDecimals;

        // Calculate USD value
        if (tokenAPriceUSD && tokenBPriceUSD) {
          const valueA = estimatedAmountA * tokenAPriceUSD;
          const valueB = estimatedAmountB * tokenBPriceUSD;
          return valueA + valueB;
        }

        // If we have tokenB price
        if (tokenBPriceUSD) {
          const valueB = estimatedAmountB * tokenBPriceUSD;
          const valueA = estimatedAmountA * priceRatio * tokenBPriceUSD;
          return valueA + valueB;
        }

        // If we have tokenA price
        if (tokenAPriceUSD) {
          const valueA = estimatedAmountA * tokenAPriceUSD;
          const valueB = (estimatedAmountB / priceRatio) * tokenAPriceUSD;
          return valueA + valueB;
        }

        // Fallback: use a conservative estimate
        // Assume minimum value based on liquidity
        return Math.max(sqrtLiquidity * 0.0001, 0);
      } catch (error) {
        this.logger.debug(`Error quoting V3 swap:`, error);
        // Fallback: use a simple heuristic based on liquidity
        const liquidityNum = Number(liquidity);
        // Very rough estimate: assume liquidity represents ~$1000 per sqrt(liquidity) unit
        return Math.sqrt(liquidityNum) * 0.001;
      }
    } catch (error) {
      this.logger.debug(`Error calculating V3 liquidity:`, error);
      return 0;
    }
  }

  /**
   * Find best V3 pool for a token pair
   * Tries all fee tiers and returns the one with highest liquidity
   */
  async findBestV3Pool(
    client: PublicClient,
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
    };

    for (const fee of UNISWAP_V3_FEES) {
      const liquidity = await this.calculateV3LiquidityUSD(
        client,
        chainId,
        tokenA,
        tokenB,
        fee,
        tokenADecimals,
        tokenBDecimals,
        tokenAPriceUSD,
        tokenBPriceUSD,
      );

      if (liquidity > bestPool.liquidityUSD) {
        bestPool = {
          exists: true,
          fee,
          liquidityUSD: liquidity,
          token0: tokenA,
          token1: tokenB,
        };
      }
    }

    return bestPool;
  }

  /**
   * Find V3 path from depositToken to targetToken (direct or via WETH)
   * Similar to findV2Path but for V3 pools
   */
  async findV3Path(
    client: PublicClient,
    chainId: number,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    depositTokenDecimals: number,
    targetTokenDecimals: number,
    depositTokenPriceUSD: number | null,
    targetTokenPriceUSD: number | null,
  ): Promise<V3PathInfo> {
    // Try direct path first
    const directPool = await this.findBestV3Pool(
      client,
      chainId,
      depositToken,
      targetToken,
      depositTokenDecimals,
      targetTokenDecimals,
      depositTokenPriceUSD,
      targetTokenPriceUSD,
    );

    if (directPool.exists && directPool.liquidityUSD >= MIN_LIQUIDITY_USD) {
      return {
        exists: true,
        liquidityUSD: directPool.liquidityUSD,
        isDirect: true,
        fee: directPool.fee,
      };
    }

    // Try 2-hop path via WETH (most common intermediate token on Ethereum)
    const WETH = ASSETS_ADDRS[chainId].WETH as `0x${string}`;

    // Find best pool for depositToken -> WETH
    const depositToWethPool = await this.findBestV3Pool(
      client,
      chainId,
      depositToken,
      WETH,
      depositTokenDecimals,
      18, // WETH decimals
      depositTokenPriceUSD,
      null, // WETH price (we'll estimate)
    );

    // Find best pool for WETH -> targetToken
    const wethToTargetPool = await this.findBestV3Pool(
      client,
      chainId,
      WETH,
      targetToken,
      18, // WETH decimals
      targetTokenDecimals,
      null, // WETH price
      targetTokenPriceUSD,
    );

    // Take minimum liquidity of the path
    const twoHopLiquidity = Math.min(
      depositToWethPool.liquidityUSD,
      wethToTargetPool.liquidityUSD,
    );

    if (
      depositToWethPool.exists &&
      wethToTargetPool.exists &&
      twoHopLiquidity >= MIN_LIQUIDITY_USD
    ) {
      return {
        exists: true,
        liquidityUSD: twoHopLiquidity,
        isDirect: false,
        depositToWethFee: depositToWethPool.fee,
        wethToTargetFee: wethToTargetPool.fee,
      };
    }

    return {
      exists: false,
      liquidityUSD: 0,
      isDirect: false,
    };
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
    return encodePacked(['address', 'uint24', 'address'], [token0, fee, token1]);
  }
}
