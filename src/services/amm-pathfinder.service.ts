import { Injectable, Logger } from '@nestjs/common';
import { ASSETS_ADDRS } from '../constants';

/**
 * Generic path candidate returned by a pool resolver.
 * The path type TPath is specific to the AMM version (V2: string[], V3: V3PathInfo structure).
 */
export interface PathCandidate<TPath> {
  exists: boolean;
  liquidityUSD: number;
  path: TPath;
  /**
   * Additional metadata that may be needed for path construction.
   * For V2: may include pair addresses.
   * For V3: may include fee tiers, pool addresses, etc.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Metadata passed to pool resolvers for path finding.
 * Contains all information needed to calculate liquidity and construct paths.
 */
export interface PathMetadata {
  chainId: number;
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  tokenADecimals: number;
  tokenBDecimals: number;
  tokenAPriceUSD: number | null;
  tokenBPriceUSD: number | null;
}

/**
 * Generic interface for pool resolvers (V2, V3, etc.).
 * Each resolver implements direct() and via() methods that return path candidates.
 */
export interface PoolResolver<TPath> {
  /**
   * Find a direct pool path between tokenA and tokenB.
   * @param meta Metadata containing chain, tokens, decimals, and prices
   * @returns Path candidate with exists, liquidityUSD, and path
   */
  direct(meta: PathMetadata): Promise<PathCandidate<TPath>>;

  /**
   * Find a 2-hop path via an intermediate token.
   * @param meta Metadata for the full path (tokenA -> mid -> tokenB)
   * @param midToken Intermediate token address
   * @param midDecimals Decimals of the intermediate token
   * @param midPriceUSD Price of the intermediate token (may be null, resolver should estimate)
   * @returns Path candidate for the 2-hop route
   */
  via(
    meta: PathMetadata,
    midToken: `0x${string}`,
    midDecimals: number,
    midPriceUSD: number | null,
  ): Promise<PathCandidate<TPath>>;
}

/**
 * Result of the best path finding algorithm.
 */
export interface BestPathResult<TPath> {
  exists: boolean;
  liquidityUSD: number;
  path: TPath;
  route: 'direct' | 'via';
  intermediate?: `0x${string}`;
  metadata?: Record<string, unknown>;
}

/**
 * Shared path-finding service that works with any pool resolver.
 * Implements the common algorithm: try direct path, then try via intermediates,
 * filter by minLiquidityUSD, and pick the best.
 */
@Injectable()
export class AmmPathfinderService {
  private readonly logger = new Logger(AmmPathfinderService.name);

  /**
   * Find the best path between two tokens using a pool resolver.
   * Tries direct path first, then paths via intermediate tokens (default: WETH).
   * Returns the path with highest liquidityUSD that meets minLiquidityUSD threshold.
   *
   * @param resolver Pool resolver implementation (V2 or V3)
   * @param meta Path metadata (chain, tokens, decimals, prices)
   * @param minLiquidityUSD Minimum liquidity threshold in USD
   * @param intermediates Array of intermediate tokens to try (default: [WETH])
   * @returns Best path result or null if no valid path found
   */
  async bestPath<TPath>(
    resolver: PoolResolver<TPath>,
    meta: PathMetadata,
    minLiquidityUSD: number = 1000,
    intermediates?: Array<{
      token: `0x${string}`;
      decimals: number;
      priceUSD: number | null;
    }>,
  ): Promise<BestPathResult<TPath> | null> {
    const candidates: Array<{
      candidate: PathCandidate<TPath>;
      route: 'direct' | 'via';
      intermediate?: `0x${string}`;
    }> = [];

    // Try direct path
    try {
      const directCandidate = await resolver.direct(meta);
      if (directCandidate.exists && directCandidate.liquidityUSD >= minLiquidityUSD) {
        candidates.push({
          candidate: directCandidate,
          route: 'direct',
        });
      }
    } catch (error) {
      this.logger.debug(
        `Error finding direct path for ${meta.tokenA}/${meta.tokenB}:`,
        error,
      );
    }

    // Try paths via intermediate tokens
    const intermediatesToTry =
      intermediates ||
      (() => {
        // Default: use WETH for the chain
        const weth = ASSETS_ADDRS[meta.chainId]?.WETH;
        if (!weth) {
          this.logger.warn(
            `No WETH address found for chainId ${meta.chainId}, skipping via paths`,
          );
          return [];
        }
        return [
          {
            token: weth as `0x${string}`,
            decimals: 18,
            priceUSD: null, // Will be estimated by resolver if needed
          },
        ];
      })();

    for (const intermediate of intermediatesToTry) {
      try {
        const viaCandidate = await resolver.via(
          meta,
          intermediate.token,
          intermediate.decimals,
          intermediate.priceUSD,
        );
        if (viaCandidate.exists && viaCandidate.liquidityUSD >= minLiquidityUSD) {
          candidates.push({
            candidate: viaCandidate,
            route: 'via',
            intermediate: intermediate.token,
          });
        }
      } catch (error) {
        this.logger.debug(
          `Error finding via path for ${meta.tokenA} -> ${intermediate.token} -> ${meta.tokenB}:`,
          error,
        );
      }
    }

    // Pick the candidate with highest liquidityUSD
    if (candidates.length === 0) {
      return null;
    }

    const best = candidates.reduce((prev, curr) =>
      curr.candidate.liquidityUSD > prev.candidate.liquidityUSD ? curr : prev,
    );

    return {
      exists: true,
      liquidityUSD: best.candidate.liquidityUSD,
      path: best.candidate.path,
      route: best.route,
      intermediate: best.intermediate,
      metadata: best.candidate.metadata,
    };
  }

  /**
   * Generate a stable cache key that does NOT depend on volatile price inputs.
   * Uses: chainId + token addresses + route type + intermediate (if via) + fee tier (if V3).
   *
   * @param chainId Chain ID
   * @param tokenA Token A address
   * @param tokenB Token B address
   * @param route Route type ('direct' or 'via')
   * @param intermediate Intermediate token address (if via route)
   * @param feeTier Fee tier for V3 (optional)
   * @returns Stable cache key string
   */
  static createCacheKey(
    chainId: number,
    tokenA: `0x${string}`,
    tokenB: `0x${string}`,
    route: 'direct' | 'via',
    intermediate?: `0x${string}`,
    feeTier?: number,
  ): string {
    const parts = [
      chainId.toString(),
      tokenA.toLowerCase(),
      tokenB.toLowerCase(),
      route,
    ];
    if (route === 'via' && intermediate) {
      parts.push(intermediate.toLowerCase());
    }
    if (feeTier !== undefined) {
      parts.push(`fee${feeTier}`);
    }
    return parts.join('-');
  }
}

