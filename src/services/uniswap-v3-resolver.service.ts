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
import { ethers } from 'ethers';

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
   * Returns [liquidityUSD, poolAddress, calculatedTokenBPriceUSD]
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
  ): Promise<[number, string, number | null]> {
    try {
      const { exists, poolAddress } = await this.checkV3Pool(
        client,
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
        client.readContract({
          address: poolAddress,
          abi: V3_POOL_ABI,
          functionName: 'token0',
        }) as Promise<`0x${string}`>,
        client.readContract({
          address: poolAddress,
          abi: V3_POOL_ABI,
          functionName: 'token1',
        }) as Promise<`0x${string}`>,
      ]);
  
      // Minimal ERC20 ABI
      const ERC20_ABI = parseAbi([
        'function balanceOf(address) view returns (uint256)',
      ]);
  
      // Read balances of token0/token1 held by pool
      const [balance0Raw, balance1Raw] = await Promise.all([
        client.readContract({
          address: token0,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [poolAddress],
        }) as Promise<bigint>,
        client.readContract({
          address: token1,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [poolAddress],
        }) as Promise<bigint>,
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
  
      // Convert balances safely (string -> number)
      // (Pour une TVL énorme, number peut perdre un peu de précision, mais évite overflow direct)
      const amount0 = Number(ethers.formatUnits(balance0Raw, decimals0));
      const amount1 = Number(ethers.formatUnits(balance1Raw, decimals1));
  
      // Read slot0 to get tick
      const slot0 = await client.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: 'slot0',
      });
  
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
  
        const liquidityUSD = amount0 * token0PriceUSD + amount1 * token1PriceUSD;
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
  
        const token0PriceUSD = token0IsTokenA ? tokenAPriceUSD : calculatedTokenBPriceUSD;
        const token1PriceUSD = token1IsTokenA ? tokenAPriceUSD : calculatedTokenBPriceUSD;
  
        const liquidityUSD = amount0 * token0PriceUSD + amount1 * token1PriceUSD;
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
  
        const token0PriceUSD = token0IsTokenA ? calculatedTokenAPriceUSD : tokenBPriceUSD;
        const token1PriceUSD = token1IsTokenA ? calculatedTokenAPriceUSD : tokenBPriceUSD;
  
        const liquidityUSD = amount0 * token0PriceUSD + amount1 * token1PriceUSD;
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
      poolAddress: '',
      calculatedTokenBPriceUSD: null,
    };

    for (const fee of UNISWAP_V3_FEES) {
      const [liquidity, poolAddress, calculatedTokenBPriceUSD] = await this.calculateV3LiquidityUSD(
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
      // Note: calculatedTokenBPriceUSD is returned but not used here

      this.logger.debug(`findBestV3Pool V3 liquidity for ${tokenA}/${tokenB} fee ${fee}: ${liquidity} ${poolAddress}`);

      if (liquidity > bestPool.liquidityUSD) {
        bestPool = {
          exists: true,
          fee,
          liquidityUSD: liquidity,
          token0: tokenA,
          token1: tokenB,
          poolAddress,
          calculatedTokenBPriceUSD
        };
      }
    }

    if (bestPool.liquidityUSD > 0) {
      this.logger.debug(`findBestV3Pool Best V3 pool for ${tokenA}/${tokenB} fee ${bestPool.fee} with liquidity ${bestPool.liquidityUSD} ${bestPool.poolAddress}`);
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

    console.log('directPool', directPool, depositTokenPriceUSD, targetTokenPriceUSD);

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

    console.log('depositToWethPool', depositToWethPool, depositTokenPriceUSD, depositToWethPool.calculatedTokenBPriceUSD);

    // Find best pool for WETH -> targetToken
    const wethToTargetPool = await this.findBestV3Pool(
      client,
      chainId,
      WETH,
      targetToken,
      18, // WETH decimals
      targetTokenDecimals,
      depositToWethPool.calculatedTokenBPriceUSD, // WETH price
      targetTokenPriceUSD,
    );

    this.logger.debug(`V3 liquidity for WETH -> targetToken: ${wethToTargetPool.liquidityUSD}`);



    // Take minimum liquidity of the path
    const twoHopLiquidityToCheck = Math.min(
      depositToWethPool.liquidityUSD,
      wethToTargetPool.liquidityUSD,
    );

    if (
      depositToWethPool.exists &&
      wethToTargetPool.exists &&
      twoHopLiquidityToCheck >= MIN_LIQUIDITY_USD
    ) {
      return {
        exists: true,
        liquidityUSD: wethToTargetPool.liquidityUSD,
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
