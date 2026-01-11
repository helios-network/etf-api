/**
 * Example usage of the shared AMM pathfinder service
 * 
 * This file demonstrates how to use the bestPath() function with both
 * Uniswap V2 and V3 resolvers. It shows the shared abstraction in action.
 * 
 * Note: This is an example file, not meant to be executed directly.
 * Import and use these patterns in your actual code.
 */

import { AmmPathfinderService, PathMetadata } from './amm-pathfinder.service';
import { UniswapV2ResolverService } from './uniswap-v2-resolver.service';
import { UniswapV3ResolverService } from './uniswap-v3-resolver.service';
import { ASSETS_ADDRS } from '../constants';
import { ChainId } from '../config/web3';

/**
 * Example: Find best V2 path between two tokens
 */
export async function exampleFindV2Path(
  v2Resolver: UniswapV2ResolverService,
  chainId: number,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  tokenADecimals: number,
  tokenBDecimals: number,
  tokenAPriceUSD: number | null,
  tokenBPriceUSD: number | null,
) {
  const pathfinder = new AmmPathfinderService();

  const meta: PathMetadata = {
    chainId,
    tokenA,
    tokenB,
    tokenADecimals,
    tokenBDecimals,
    tokenAPriceUSD,
    tokenBPriceUSD,
  };

  // Use shared bestPath algorithm
  const result = await pathfinder.bestPath(
    v2Resolver, // V2 resolver implements PoolResolver<string[]>
    meta,
    1000, // minLiquidityUSD
    // Optional: specify intermediates (defaults to WETH)
    // [
    //   {
    //     token: ASSETS_ADDRS[chainId].WETH as `0x${string}`,
    //     decimals: 18,
    //     priceUSD: null, // Will be estimated
    //   },
    //   {
    //     token: ASSETS_ADDRS[chainId].USDC as `0x${string}`,
    //     decimals: 6,
    //     priceUSD: 1.0, // USDC is stablecoin
    //   },
    // ],
  );

  if (result) {
    console.log('V2 Path found:');
    console.log(`  Route: ${result.route}`);
    console.log(`  Liquidity: $${result.liquidityUSD}`);
    console.log(`  Path: ${result.path.join(' -> ')}`);
    if (result.intermediate) {
      console.log(`  Intermediate: ${result.intermediate}`);
    }
    return result;
  } else {
    console.log('No valid V2 path found');
    return null;
  }
}

/**
 * Example: Find best V3 path between two tokens
 */
export async function exampleFindV3Path(
  v3Resolver: UniswapV3ResolverService,
  chainId: number,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  tokenADecimals: number,
  tokenBDecimals: number,
  tokenAPriceUSD: number | null,
  tokenBPriceUSD: number | null,
) {
  const pathfinder = new AmmPathfinderService();

  const meta: PathMetadata = {
    chainId,
    tokenA,
    tokenB,
    tokenADecimals,
    tokenBDecimals,
    tokenAPriceUSD,
    tokenBPriceUSD,
  };

  // Use shared bestPath algorithm
  const result = await pathfinder.bestPath(
    v3Resolver, // V3 resolver implements PoolResolver<V3PathInfo>
    meta,
    1000, // minLiquidityUSD
  );

  if (result) {
    console.log('V3 Path found:');
    console.log(`  Route: ${result.route}`);
    console.log(`  Liquidity: $${result.liquidityUSD}`);
    console.log(`  Is Direct: ${result.path.isDirect}`);
    if (result.path.isDirect) {
      console.log(`  Fee Tier: ${result.path.fee}`);
    } else {
      console.log(
        `  Fee Tiers: ${result.path.depositToWethFee} -> ${result.path.wethToTargetFee}`,
      );
    }
    if (result.intermediate) {
      console.log(`  Intermediate: ${result.intermediate}`);
    }
    return result;
  } else {
    console.log('No valid V3 path found');
    return null;
  }
}

/**
 * Example: Compare V2 vs V3 paths for the same token pair
 */
export async function exampleCompareV2V3(
  v2Resolver: UniswapV2ResolverService,
  v3Resolver: UniswapV3ResolverService,
  chainId: number,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  tokenADecimals: number,
  tokenBDecimals: number,
  tokenAPriceUSD: number | null,
  tokenBPriceUSD: number | null,
) {
  const pathfinder = new AmmPathfinderService();
  const meta: PathMetadata = {
    chainId,
    tokenA,
    tokenB,
    tokenADecimals,
    tokenBDecimals,
    tokenAPriceUSD,
    tokenBPriceUSD,
  };

  const [v2Result, v3Result] = await Promise.all([
    pathfinder.bestPath(v2Resolver, meta, 1000),
    pathfinder.bestPath(v3Resolver, meta, 1000),
  ]);

  console.log('=== Path Comparison ===');
  console.log('V2:', v2Result ? `$${v2Result.liquidityUSD}` : 'No path');
  console.log('V3:', v3Result ? `$${v3Result.liquidityUSD}` : 'No path');

  // Pick the best option
  if (v2Result && v3Result) {
    const best = v2Result.liquidityUSD > v3Result.liquidityUSD ? 'V2' : 'V3';
    console.log(`Best option: ${best}`);
  } else if (v2Result) {
    console.log('Best option: V2 (only option)');
  } else if (v3Result) {
    console.log('Best option: V3 (only option)');
  } else {
    console.log('No valid paths found');
  }

  return { v2: v2Result, v3: v3Result };
}

/**
 * Example: Using multiple intermediate tokens
 * This shows how to extend beyond just WETH
 */
export async function exampleMultipleIntermediates(
  v2Resolver: UniswapV2ResolverService,
  chainId: number,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  tokenADecimals: number,
  tokenBDecimals: number,
  tokenAPriceUSD: number | null,
  tokenBPriceUSD: number | null,
) {
  const pathfinder = new AmmPathfinderService();
  const meta: PathMetadata = {
    chainId,
    tokenA,
    tokenB,
    tokenADecimals,
    tokenBDecimals,
    tokenAPriceUSD,
    tokenBPriceUSD,
  };

  const weth = ASSETS_ADDRS[chainId]?.WETH;
  const usdc = ASSETS_ADDRS[chainId]?.USDC;

  if (!weth || !usdc) {
    throw new Error(`Missing WETH or USDC for chainId ${chainId}`);
  }

  // Try multiple intermediates: WETH and USDC
  const result = await pathfinder.bestPath(
    v2Resolver,
    meta,
    1000,
    [
      {
        token: weth as `0x${string}`,
        decimals: 18,
        priceUSD: null, // Will be estimated
      },
      {
        token: usdc as `0x${string}`,
        decimals: 6,
        priceUSD: 1.0, // USDC is stablecoin
      },
    ],
  );

  if (result) {
    console.log(`Best path found via: ${result.intermediate}`);
    console.log(`Liquidity: $${result.liquidityUSD}`);
  }

  return result;
}

