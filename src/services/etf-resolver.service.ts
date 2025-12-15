import { Injectable, Logger } from '@nestjs/common';
import { type PublicClient, erc20Abi, encodeAbiParameters } from 'viem';
import { MIN_LIQUIDITY_USD } from '../constants';
import { ChainlinkResolverService } from './chainlink-resolver.service';
import { UniswapV2ResolverService } from './uniswap-v2-resolver.service';
import { UniswapV3ResolverService } from './uniswap-v3-resolver.service';
import {
  TokenMetadata,
  ResolutionResult,
  PricingMode,
  DepositPath,
  WithdrawPath,
} from '../types/etf-verify.types';

@Injectable()
export class EtfResolverService {
  private readonly logger = new Logger(EtfResolverService.name);

  constructor(
    private readonly chainlinkResolver: ChainlinkResolverService,
    private readonly uniswapV2Resolver: UniswapV2ResolverService,
    private readonly uniswapV3Resolver: UniswapV3ResolverService,
  ) {}

  /**
   * Get token metadata (symbol, decimals) from blockchain
   */
  async getTokenMetadata(
    client: PublicClient,
    tokenAddress: `0x${string}`,
  ): Promise<TokenMetadata> {
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'symbol',
        }),
        client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
      ]);

      return {
        address: tokenAddress,
        symbol: symbol as string,
        decimals: Number(decimals),
      };
    } catch (error) {
      throw new Error(`Failed to fetch token metadata for ${tokenAddress}: ${error}`);
    }
  }

  /**
   * Get price from Chainlink feed
   */
  async getChainlinkPrice(
    client: PublicClient,
    feedAddress: `0x${string}`,
    decimals: number,
  ): Promise<number | null> {
    try {
      const priceFeedAbi = [
        {
          type: 'function',
          name: 'latestRoundData',
          inputs: [],
          outputs: [
            { name: 'roundId', type: 'uint80' },
            { name: 'answer', type: 'int256' },
            { name: 'startedAt', type: 'uint256' },
            { name: 'updatedAt', type: 'uint256' },
            { name: 'answeredInRound', type: 'uint80' },
          ],
          stateMutability: 'view',
        },
      ] as const;

      const result = await client.readContract({
        address: feedAddress,
        abi: priceFeedAbi,
        functionName: 'latestRoundData',
      });

      const answer = result[1] as bigint;
      return Number(answer) / 10 ** decimals;
    } catch (error) {
      this.logger.error(`Error fetching Chainlink price from ${feedAddress}:`, error);
      return null;
    }
  }

  /**
   * Encode V2 paths for deposit/withdraw
   * Format: encode(["address[]", "address[]"], [depositPath, withdrawPath])
   */
  private encodeV2Paths(depositPath: string[], withdrawPath: string[]): string {
    return encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'address[]' }],
      [depositPath as `0x${string}`[], withdrawPath as `0x${string}`[]],
    );
  }

  /**
   * Find all possible pricing modes for a token
   * Returns an array of modes that are valid for this token
   */
  async findPossibleModes(
    client: PublicClient,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    chainId: number,
    depositTokenMetadata: TokenMetadata,
    targetTokenMetadata: TokenMetadata,
  ): Promise<PricingMode[]> {
    const possibleModes: PricingMode[] = [];

    // Get USDC feed for pricing
    const usdcFeed = await this.chainlinkResolver.resolveUSDCFeed(chainId);
    const usdcPrice = usdcFeed
      ? await this.getChainlinkPrice(
          client,
          usdcFeed.proxyAddress as `0x${string}`,
          usdcFeed.decimals,
        )
      : null;

    // Check for Chainlink feed
    let targetFeed = await this.chainlinkResolver.resolveChainlinkFeed(
      targetTokenMetadata.symbol,
      chainId,
    );
    if (!targetFeed && targetTokenMetadata.symbol.startsWith('W')) {
      const wrappedToken = await this.chainlinkResolver.resolveChainlinkFeed(
        targetTokenMetadata.symbol.slice(1),
        chainId,
      );
      if (wrappedToken) {
        targetFeed = wrappedToken;
      }
    }

    const hasFeed = targetFeed !== null;
    let targetPrice: number | null = null;
    if (hasFeed) {
      targetPrice = await this.getChainlinkPrice(
        client,
        targetFeed!.proxyAddress as `0x${string}`,
        targetFeed!.decimals,
      );
    }

    // Check Mode 1: V2 + Chainlink Feed
    if (hasFeed && targetPrice) {
      const v2Path = await this.uniswapV2Resolver.findV2Path(
        client,
        depositToken,
        targetToken,
        depositTokenMetadata.decimals,
        targetTokenMetadata.decimals,
        usdcPrice,
        targetPrice,
      );
      if (v2Path.exists && v2Path.liquidityUSD >= MIN_LIQUIDITY_USD) {
        possibleModes.push('V2_PLUS_FEED');
      }
    }

    // Check Mode 2: V3 + Chainlink Feed
    if (hasFeed && targetPrice) {
      const v3Path = await this.uniswapV3Resolver.findV3Path(
        client,
        depositToken,
        targetToken,
        depositTokenMetadata.decimals,
        targetTokenMetadata.decimals,
        usdcPrice,
        targetPrice,
      );
      if (v3Path.exists && v3Path.liquidityUSD >= MIN_LIQUIDITY_USD) {
        possibleModes.push('V3_PLUS_FEED');
      }
    }

    // Check Mode 3: V2 + V2 (DEX-only)
    const v2Path = await this.uniswapV2Resolver.findV2Path(
      client,
      depositToken,
      targetToken,
      depositTokenMetadata.decimals,
      targetTokenMetadata.decimals,
      usdcPrice,
      null,
    );
    if (v2Path.exists && v2Path.liquidityUSD >= MIN_LIQUIDITY_USD) {
      possibleModes.push('V2_PLUS_V2');
    }

    // Check Mode 4: V3 + V3 (last resort)
    const v3Path = await this.uniswapV3Resolver.findV3Path(
      client,
      depositToken,
      targetToken,
      depositTokenMetadata.decimals,
      targetTokenMetadata.decimals,
      usdcPrice,
      null,
    );
    if (v3Path.exists && v3Path.liquidityUSD >= MIN_LIQUIDITY_USD) {
      possibleModes.push('V3_PLUS_V3');
    }

    return possibleModes;
  }

  /**
   * Resolve token with a specific pricing mode
   */
  async resolveTokenWithMode(
    client: PublicClient,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    chainId: number,
    depositTokenMetadata: TokenMetadata,
    targetTokenMetadata: TokenMetadata,
    pricingMode: PricingMode,
  ): Promise<ResolutionResult> {
    // Get USDC feed for pricing
    const usdcFeed = await this.chainlinkResolver.resolveUSDCFeed(chainId);
    const usdcPrice = usdcFeed
      ? await this.getChainlinkPrice(
          client,
          usdcFeed.proxyAddress as `0x${string}`,
          usdcFeed.decimals,
        )
      : null;

    // Get target feed if available
    let targetFeed = await this.chainlinkResolver.resolveChainlinkFeed(
      targetTokenMetadata.symbol,
      chainId,
    );
    if (!targetFeed && targetTokenMetadata.symbol.startsWith('W')) {
      const wrappedToken = await this.chainlinkResolver.resolveChainlinkFeed(
        targetTokenMetadata.symbol.slice(1),
        chainId,
      );
      if (wrappedToken) {
        targetFeed = wrappedToken;
      }
    }

    const targetPrice = targetFeed
      ? await this.getChainlinkPrice(
          client,
          targetFeed.proxyAddress as `0x${string}`,
          targetFeed.decimals,
        )
      : null;

    // Resolve based on specific mode
    switch (pricingMode) {
      case 'V2_PLUS_FEED':
        if (!targetFeed || !targetPrice) {
          throw new Error('V2_PLUS_FEED requires Chainlink feed');
        }
        const v2PathFeed = await this.uniswapV2Resolver.findV2Path(
          client,
          depositToken,
          targetToken,
          depositTokenMetadata.decimals,
          targetTokenMetadata.decimals,
          usdcPrice,
          targetPrice,
        );
        if (!v2PathFeed.exists || v2PathFeed.liquidityUSD < MIN_LIQUIDITY_USD) {
          throw new Error('V2_PLUS_FEED: Insufficient liquidity');
        }
        const withdrawPathFeed = [...v2PathFeed.path].reverse();
        const encodedFeed = this.encodeV2Paths(v2PathFeed.path, withdrawPathFeed);
        return {
          pricingMode: 'V2_PLUS_FEED',
          feed: targetFeed,
          depositPath: {
            type: 'V2',
            encoded: encodedFeed,
            path: v2PathFeed.path,
          },
          withdrawPath: {
            type: 'V2',
            encoded: encodedFeed,
            path: withdrawPathFeed,
          },
          liquidityUSD: v2PathFeed.liquidityUSD,
        };

      case 'V3_PLUS_FEED':
        if (!targetFeed || !targetPrice) {
          throw new Error('V3_PLUS_FEED requires Chainlink feed');
        }
        const v3PathFeed = await this.uniswapV3Resolver.findV3Path(
          client,
          depositToken,
          targetToken,
          depositTokenMetadata.decimals,
          targetTokenMetadata.decimals,
          usdcPrice,
          targetPrice,
        );
        if (!v3PathFeed.exists || v3PathFeed.liquidityUSD < MIN_LIQUIDITY_USD) {
          throw new Error('V3_PLUS_FEED: Insufficient liquidity');
        }
        return this.encodeV3ResolutionResult(
          v3PathFeed,
          depositToken,
          targetToken,
          targetFeed,
        );

      case 'V2_PLUS_V2':
        const v2Path = await this.uniswapV2Resolver.findV2Path(
          client,
          depositToken,
          targetToken,
          depositTokenMetadata.decimals,
          targetTokenMetadata.decimals,
          usdcPrice,
          null,
        );
        if (!v2Path.exists || v2Path.liquidityUSD < MIN_LIQUIDITY_USD) {
          throw new Error('V2_PLUS_V2: Insufficient liquidity');
        }
        const withdrawPath = [...v2Path.path].reverse();
        const encoded = this.encodeV2Paths(v2Path.path, withdrawPath);
        return {
          pricingMode: 'V2_PLUS_V2',
          feed: null,
          depositPath: {
            type: 'V2',
            encoded: encoded,
            path: v2Path.path,
          },
          withdrawPath: {
            type: 'V2',
            encoded: encoded,
            path: withdrawPath,
          },
          liquidityUSD: v2Path.liquidityUSD,
        };

      case 'V3_PLUS_V3':
        const v3Path = await this.uniswapV3Resolver.findV3Path(
          client,
          depositToken,
          targetToken,
          depositTokenMetadata.decimals,
          targetTokenMetadata.decimals,
          usdcPrice,
          null,
        );
        if (!v3Path.exists || v3Path.liquidityUSD < MIN_LIQUIDITY_USD) {
          throw new Error('V3_PLUS_V3: Insufficient liquidity');
        }
        return this.encodeV3ResolutionResult(v3Path, depositToken, targetToken, null);

      default:
        throw new Error(`Unknown pricing mode: ${pricingMode}`);
    }
  }

  /**
   * Helper function to encode V3 resolution result
   */
  private encodeV3ResolutionResult(
    v3Path: {
      exists: boolean;
      liquidityUSD: number;
      isDirect: boolean;
      fee?: number;
      depositToWethFee?: number;
      wethToTargetFee?: number;
    },
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    feed: any,
  ): ResolutionResult {
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`;

    let v3PathBytes: string;
    let fee: number;

    if (v3Path.isDirect && v3Path.fee) {
      v3PathBytes = this.uniswapV3Resolver.encodeV3Path(
        depositToken,
        v3Path.fee,
        targetToken,
      );
      fee = v3Path.fee;
    } else if (v3Path.depositToWethFee && v3Path.wethToTargetFee) {
      v3PathBytes = this.uniswapV3Resolver.encodeV3Path(
        depositToken,
        v3Path.depositToWethFee,
        WETH,
        v3Path.wethToTargetFee,
        targetToken,
      );
      fee = v3Path.depositToWethFee;
    } else {
      throw new Error('Invalid V3 path configuration');
    }

    const encoded = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint24' }],
      [v3PathBytes as `0x${string}`, fee],
    );

    let withdrawPathBytes: string;
    if (v3Path.isDirect && v3Path.fee) {
      withdrawPathBytes = this.uniswapV3Resolver.encodeV3Path(
        targetToken,
        v3Path.fee,
        depositToken,
      );
    } else if (v3Path.depositToWethFee && v3Path.wethToTargetFee) {
      withdrawPathBytes = this.uniswapV3Resolver.encodeV3Path(
        targetToken,
        v3Path.wethToTargetFee,
        WETH,
        v3Path.depositToWethFee,
        depositToken,
      );
    } else {
      throw new Error('Invalid V3 path configuration');
    }

    const withdrawEncoded = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint24' }],
      [withdrawPathBytes as `0x${string}`, fee],
    );

    const pricingMode = feed ? 'V3_PLUS_FEED' : 'V3_PLUS_V3';

    return {
      pricingMode: pricingMode as PricingMode,
      feed: feed,
      depositPath: {
        type: 'V3',
        encoded: encoded,
        token0: depositToken,
        token1: targetToken,
        fee: fee,
      },
      withdrawPath: {
        type: 'V3',
        encoded: withdrawEncoded,
        token0: targetToken,
        token1: depositToken,
        fee: fee,
      },
      liquidityUSD: v3Path.liquidityUSD,
    };
  }
}
