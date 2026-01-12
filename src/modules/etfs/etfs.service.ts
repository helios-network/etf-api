import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from 'src/infrastructure/cache/cache.service';
import {
  ETF,
  ETFDocument,
  WalletHolding,
  WalletHoldingDocument,
} from 'src/models';
import {
  Web3Service,
  EtfResolverService,
  ChainlinkResolverService,
  UniswapV2ResolverService,
  UniswapV3ResolverService,
} from 'src/services';
import { ChainId } from 'src/config/web3';
import {
  ETF_CONTRACT_ADDRS,
  MIN_LIQUIDITY_USD,
  UNISWAP_V2_ROUTER_ADDRS,
  UNISWAP_V3_ROUTER_ADDRS,
  UNISWAP_V3_QUOTER_ADDRS,
} from 'src/constants';
import {
  VerifyResponse,
  VerifySuccessResponse,
  VerifyErrorResponse,
  ComponentVerification,
  PricingMode,
  TokenMetadata,
} from 'src/types/etf-verify.types';
import { normalizeEthAddress } from 'src/common/utils/eip55';

import { VerifyEtfDto } from './dto/verify-etf.dto';

@Injectable()
export class EtfsService {
  private readonly logger = new Logger(EtfsService.name);

  constructor(
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
    @InjectModel(WalletHolding.name)
    private walletHoldingModel: Model<WalletHoldingDocument>,
    private readonly cacheService: CacheService,
    private readonly web3Service: Web3Service,
    private readonly etfResolver: EtfResolverService,
    private readonly chainlinkResolver: ChainlinkResolverService,
    private readonly uniswapV2Resolver: UniswapV2ResolverService,
    private readonly uniswapV3Resolver: UniswapV3ResolverService,
  ) {}

  async getAll(page: number, size: number, search?: string, wallet?: string) {
    // Validate pagination parameters
    if (page < 1) {
      throw new Error('Page must be greater than 0');
    }

    if (size < 1 || size > 100) {
      throw new Error('Size must be between 1 and 100');
    }

    const normalizedSearch = search && search.trim() ? search.trim() : '';
    const searchFilter = normalizedSearch
      ? {
          $or: [
            { name: { $regex: normalizedSearch, $options: 'i' } },
            { symbol: { $regex: normalizedSearch, $options: 'i' } },
            { 'assets.symbol': { $regex: normalizedSearch, $options: 'i' } },
          ],
        }
      : {};
    const normalizedWallet = wallet ? normalizeEthAddress(wallet) : '';
    // Build cache key with all parameters that influence the result
    const cacheKey = `list:page=${page}:size=${size}:search=${normalizedSearch}:wallet=${normalizedWallet}`;

    // Use cache-aside pattern with 60 seconds TTL
    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        // Calculate skip value
        const skip = (page - 1) * size;

        // Get total count for pagination metadata
        const total = await this.etfModel.countDocuments(searchFilter);

        const heldEtfs: any[] = [];

        if (normalizedWallet) {
          const walletHolding = await this.walletHoldingModel
            .findOne({
              wallet: normalizedWallet,
            })
            .lean()
            .exec();

          if (walletHolding) {
            const holdingEtfVaultIds = walletHolding.deposits.map(
              (e) => e.etfVaultAddress,
            );
            const holdingEtfs = await this.etfModel
              .find({ vault: { $in: holdingEtfVaultIds } })
              .sort({ createdAt: -1 })
              .limit(size)
              .lean()
              .exec();
            heldEtfs.push(
              ...holdingEtfs.map((etf) => ({ ...etf, held: true })),
            );
          }
        }

        // Fetch ETFs with pagination
        const etfs = await this.etfModel
          .find({
            ...searchFilter,
            _id: { $nin: heldEtfs.map((etf) => etf._id) },
          })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(size - heldEtfs.length)
          .lean()
          .exec();

        // Calculate pagination metadata
        const totalPages = Math.ceil(total / size);
        const hasNextPage = page < totalPages;
        const hasPreviousPage = page > 1;

        return {
          success: true,
          data: [...heldEtfs, ...etfs],
          pagination: {
            page,
            size,
            total,
            totalPages,
            hasNextPage,
            hasPreviousPage,
          },
        };
      },
      {
        namespace: 'etfs',
        ttl: 60, // 60 seconds
      },
    );
  }

  async getEtfWithVault(vaultAddress: string) {
    // Build cache key with all parameters that influence the result
    const normalizedVault = normalizeEthAddress(vaultAddress);

    const cacheKey = `etf:vaultAddress=${normalizedVault}`;

    // Use cache-aside pattern with 60 seconds TTL
    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        // Fetch ETF
        const etf = await this.etfModel
          .findOne({ vault: normalizedVault })
          .lean()
          .exec();

        return {
          success: true,
          data: etf,
        };
      },
      {
        namespace: 'etf',
        ttl: 60, // 60 seconds
      },
    );
  }

  async getStatistics() {
    const cacheKey = 'statistics';

    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        const totalEtfs = await this.etfModel.countDocuments({});

        const statsResult = await this.etfModel.aggregate([
          {
            $group: {
              _id: null,
              totalTVL: { $sum: { $ifNull: ['$tvl', 0] } },
              totalDailyVolume: { $sum: { $ifNull: ['$dailyVolumeUSD', 0] } },
            },
          },
        ]);

        const stats = statsResult[0] || { totalTVL: 0, totalDailyVolume: 0 };

        return {
          success: true,
          data: {
            totalEtfs,
            totalTVL: Number(stats.totalTVL.toFixed(2)),
            totalDailyVolume: Number(stats.totalDailyVolume.toFixed(2)),
          },
        };
      },
      {
        namespace: 'etfs',
        ttl: 60,
      },
    );
  }

  async verifyETF(body: VerifyEtfDto): Promise<VerifyResponse> {
    // No cache for POST /verify (calculation operation)

    // Validate input
    if (
      !body.chainId ||
      !body.depositToken ||
      !body.components ||
      !Array.isArray(body.components)
    ) {
      const errorResponse: VerifyErrorResponse = {
        status: 'ERROR',
        reason: 'INVALID_INPUT',
        details: {
          token: '',
          message:
            'Missing required fields: chainId, depositToken, or components',
        },
      };
      return errorResponse;
    }

    if (body.components.length === 0) {
      const errorResponse: VerifyErrorResponse = {
        status: 'ERROR',
        reason: 'INVALID_INPUT',
        details: {
          token: '',
          message: 'Components array cannot be empty',
        },
      };
      return errorResponse;
    }

    // Validate weights sum to 100
    const totalWeight = body.components.reduce(
      (sum, comp) => sum + comp.weight,
      0,
    );
    if (Math.abs(totalWeight - 100) > 0.01) {
      const errorResponse: VerifyErrorResponse = {
        status: 'ERROR',
        reason: 'INVALID_INPUT',
        details: {
          token: '',
          message: `Weights must sum to 100, got ${totalWeight}`,
        },
      };
      return errorResponse;
    }

    // Get blockchain client
    const chainId = body.chainId as ChainId;
    const client = this.web3Service.getPublicClient(chainId);
    if (!client) {
      const errorResponse: VerifyErrorResponse = {
        status: 'ERROR',
        reason: 'INVALID_INPUT',
        details: {
          token: '',
          message: `Unsupported chainId: ${chainId}`,
        },
      };
      return errorResponse;
    }

    const depositToken = body.depositToken as `0x${string}`;

    // Get deposit token metadata
    let depositTokenMetadata: TokenMetadata;
    try {
      depositTokenMetadata = await this.etfResolver.getTokenMetadata(
        depositToken,
        chainId,
      );
    } catch (error) {
      const errorResponse: VerifyErrorResponse = {
        status: 'ERROR',
        reason: 'INVALID_INPUT',
        details: {
          token: depositToken,
          message: `Failed to fetch deposit token metadata: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        },
      };
      return errorResponse;
    }

    // Step 1: Find all possible modes for each token
    const tokenModes: Map<string, PricingMode[]> = new Map();
    const tokenMetadataMap: Map<string, TokenMetadata> = new Map();

    let hasDepositTokenInComponents = false;
    this.etfResolver.resetCache();
    for (const component of body.components) {
      const targetToken = component.token as `0x${string}`;

      try {
        // Get target token metadata
        const targetTokenMetadata = await this.etfResolver.getTokenMetadata(
          targetToken,
          chainId,
        );

        tokenMetadataMap.set(targetToken, targetTokenMetadata);

        // setup empty data if target token is the same as deposit token
        if (targetToken.toLowerCase() === depositToken.toLowerCase()) {
          hasDepositTokenInComponents = true;
          continue;
        }

        // Find all possible modes for this token
        const possibleModes = await this.etfResolver.findPossibleModes(
          depositToken,
          targetToken,
          chainId,
          depositTokenMetadata,
          targetTokenMetadata,
        );

        if (possibleModes.length === 0) {
          const errorResponse: VerifyErrorResponse = {
            status: 'ERROR',
            reason: 'INSUFFICIENT_LIQUIDITY',
            details: {
              token: targetTokenMetadata.symbol,
              requiredUSD: MIN_LIQUIDITY_USD,
              message: 'No valid pricing mode found for this token',
            },
          };
          return errorResponse;
        }

        tokenModes.set(targetToken, possibleModes);
      } catch (error) {
        let targetSymbol = component.token;
        try {
          const metadata = await this.etfResolver.getTokenMetadata(
            targetToken,
            chainId,
          );
          targetSymbol = metadata.symbol;
        } catch {
          // Keep original token address if metadata fetch fails
        }

        const errorResponse: VerifyErrorResponse = {
          status: 'ERROR',
          reason: 'NO_POOL_FOUND',
          details: {
            token: targetSymbol,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
        return errorResponse;
      }
    }

    // Step 2: Find the optimal common mode
    // Order of preference: V2_PLUS_FEED > V3_PLUS_FEED > V2_PLUS_V2 > V3_PLUS_V3
    const modePriority: PricingMode[] = [
      'V2_PLUS_FEED',
      'V3_PLUS_FEED',
      'V2_PLUS_V2',
      'V3_PLUS_V3',
    ];

    let commonMode: PricingMode | null = null;
    for (const mode of modePriority) {
      const allTokensSupportMode = Array.from(tokenModes.values()).every(
        (modes) => modes.includes(mode),
      );
      if (allTokensSupportMode) {
        commonMode = mode;
        break;
      }
    }

    if (!commonMode) {
      const errorResponse: VerifyErrorResponse = {
        status: 'ERROR',
        reason: 'NO_POOL_FOUND',
        details: {
          token: '',
          message:
            'No common pricing mode found for all tokens. Each token supports different modes.',
        },
      };
      return errorResponse;
    }

    // Step 3: Resolve all tokens with the common mode
    const componentVerifications: ComponentVerification[] = [];

    for (const component of body.components) {
      const targetToken = component.token as `0x${string}`;

      // Skip if target token is the same as deposit token (will be handled at the end)
      if (targetToken.toLowerCase() === depositToken.toLowerCase()) {
        continue;
      }

      try {
        const targetTokenMetadata = tokenMetadataMap.get(targetToken)!;

        // Resolve token with the common mode
        const resolution = await this.etfResolver.resolveTokenWithMode(
          depositToken,
          targetToken,
          chainId,
          depositTokenMetadata,
          targetTokenMetadata,
          commonMode,
        );

        // Build component verification result
        const componentVerification: ComponentVerification = {
          token: targetTokenMetadata.symbol,
          tokenAddress: targetToken,
          symbol: targetTokenMetadata.symbol,
          decimals: targetTokenMetadata.decimals,
          pricingMode: commonMode, // All components use the same mode
          feed: resolution.feed?.proxyAddress || null,
          depositPath: resolution.depositPath,
          withdrawPath: resolution.withdrawPath,
          liquidityUSD: resolution.liquidityUSD,
        };

        componentVerifications.push(componentVerification);
      } catch (error) {
        const targetTokenMetadata = tokenMetadataMap.get(targetToken)!;
        const errorResponse: VerifyErrorResponse = {
          status: 'ERROR',
          reason: 'INSUFFICIENT_LIQUIDITY',
          details: {
            token: targetTokenMetadata.symbol,
            requiredUSD: MIN_LIQUIDITY_USD,
            message: `Token does not support pricing mode ${commonMode}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          },
        };
        return errorResponse;
      }
    }

    // Step 4: If deposit token is in components, add it with empty paths and deposit token feed
    if (hasDepositTokenInComponents) {
      // Get feed for deposit token
      let depositFeed = await this.chainlinkResolver.resolveChainlinkFeed(
        depositTokenMetadata.symbol,
        chainId,
      );

      // If no feed found and token symbol starts with 'W', try without 'W'
      if (!depositFeed && depositTokenMetadata.symbol.startsWith('W')) {
        depositFeed = await this.chainlinkResolver.resolveChainlinkFeed(
          depositTokenMetadata.symbol.slice(1),
          chainId,
        );
      }

      if (!depositFeed) {
        const errorResponse: VerifyErrorResponse = {
          status: 'ERROR',
          reason: 'NO_POOL_FOUND',
          details: {
            token: depositTokenMetadata.symbol,
            message: 'No feed found for deposit token',
          },
        };
        return errorResponse;
      }

      // Create empty paths based on common mode
      const emptyAddress = '0x0000000000000000000000000000000000000000';
      let emptyDepositPath: ComponentVerification['depositPath'];
      let emptyWithdrawPath: ComponentVerification['withdrawPath'];

      if (commonMode.startsWith('V2')) {
        // V2 paths: empty address array
        emptyDepositPath = {
          type: 'V2',
          encoded: this.etfResolver.encodeV2Paths(
            [emptyAddress, emptyAddress],
            [emptyAddress, emptyAddress],
          ),
          path: [emptyAddress, emptyAddress],
        };
        emptyWithdrawPath = {
          type: 'V2',
          encoded: this.etfResolver.encodeV2Paths(
            [emptyAddress, emptyAddress],
            [emptyAddress, emptyAddress],
          ),
          path: [emptyAddress, emptyAddress],
        };
      } else {
        // V3 paths: empty token0, token1, fee = 0
        const v3ResolutionResult = this.etfResolver.encodeV3ResolutionResult(
          chainId,
          {
            exists: false,
            liquidityUSD: -1,
            isDirect: true,
            fee: 100,
          },
          emptyAddress,
          emptyAddress,
          null,
        );
        emptyDepositPath = v3ResolutionResult.depositPath;
        emptyWithdrawPath = v3ResolutionResult.withdrawPath;
      }

      // Build component verification for deposit token
      const depositTokenVerification: ComponentVerification = {
        token: depositTokenMetadata.symbol,
        tokenAddress: depositToken,
        symbol: depositTokenMetadata.symbol,
        decimals: depositTokenMetadata.decimals,
        pricingMode: commonMode,
        feed: depositFeed?.proxyAddress || null,
        depositPath: emptyDepositPath,
        withdrawPath: emptyWithdrawPath,
        liquidityUSD: -1,
      };

      componentVerifications.push(depositTokenVerification);
    }

    // All components verified successfully
    const successResponse: VerifySuccessResponse = {
      status: 'OK',
      readyForCreation: true,
      factoryAddress: ETF_CONTRACT_ADDRS[chainId],
      components: componentVerifications,
    };

    return successResponse;
  }

  async getDepositTokens(chainId: number, search?: string) {
    try {
      // Get all distinct deposit tokens
      const depositTokens = await this.etfModel
        .find({ chain: chainId })
        .distinct('depositToken');

      // Filter out empty strings
      const validDepositTokens = depositTokens.filter(
        (token) => token && token.trim() !== '',
      );

      if (validDepositTokens.length === 0) {
        return {
          success: true,
          data: [],
        };
      }

      // Get metadata for each deposit token
      // Use MAINNET as default chain (as in old code)
      const client = this.web3Service.getPublicClient(chainId as ChainId);
      if (!client) {
        throw new Error('Mainnet client not available');
      }

      const depositTokenMetadata = await Promise.all(
        validDepositTokens.map(async (token) => {
          try {
            const metadata = await this.etfResolver.getTokenMetadata(
              token as `0x${string}`,
              chainId as ChainId,
            );
            return metadata;
          } catch (error) {
            this.logger.warn(
              `Failed to fetch metadata for deposit token ${token}:`,
              error,
            );
            // Return basic info if metadata fetch fails
            return {
              address: token,
              symbol: '',
              decimals: 18,
            };
          }
        }),
      );

      // Filter out tokens with empty symbols
      let filteredMetadata = depositTokenMetadata.filter(
        (metadata) => metadata.symbol !== '',
      );

      // Apply search filter if provided and not empty
      if (search && search.trim()) {
        const searchLower = search.trim().toLowerCase();
        filteredMetadata = filteredMetadata.filter((metadata) =>
          metadata.symbol?.toLowerCase().includes(searchLower),
        );
      }

      return {
        success: true,
        data: filteredMetadata,
      };
    } catch (error) {
      this.logger.error('Error fetching deposit tokens:', error);
      throw error;
    }
  }

  /**
   * Find best swap path between depositToken and targetToken
   * Returns configuration for setFeeSwapConfig
   */
  async findBestSwap(
    chainId: number,
    depositToken: `0x${string}`,
    targetToken: `0x${string}`,
    slippageBps: number = 50, // Default 0.5% slippage
  ): Promise<{
    depositToken: string;
    enabled: boolean;
    isV2: boolean;
    router: string;
    quoter: string;
    pathV2: string[];
    pathV3: string;
    tokenOut: string;
    slippageBps: number;
    liquidityUSD: number;
  }> {
    // Get token metadata
    const [depositTokenMeta, targetTokenMeta] = await Promise.all([
      this.etfResolver.getTokenMetadata(depositToken, chainId as ChainId),
      this.etfResolver.getTokenMetadata(targetToken, chainId as ChainId),
    ]);

    // Get USDC feed for pricing
    const usdcFeed = await this.chainlinkResolver.resolveUSDCFeed(chainId);
    const usdcPrice = usdcFeed
      ? await this.etfResolver.getChainlinkPrice(
          usdcFeed.proxyAddress as `0x${string}`,
          usdcFeed.decimals,
          chainId as ChainId,
        )
      : null;

    // Get target token price if available
    const targetFeed = await this.chainlinkResolver.resolveChainlinkFeed(
      targetTokenMeta.symbol,
      chainId,
    );
    const targetPrice = targetFeed
      ? await this.etfResolver.getChainlinkPrice(
          targetFeed.proxyAddress as `0x${string}`,
          targetFeed.decimals,
          chainId as ChainId,
        )
      : null;

    // Try V2 path
    const v2Path = await this.uniswapV2Resolver.findV2Path(
      chainId,
      depositToken,
      targetToken,
      depositTokenMeta.decimals,
      targetTokenMeta.decimals,
      usdcPrice,
      targetPrice,
    );

    // Try V3 path
    const v3Path = await this.uniswapV3Resolver.findV3Path(
      chainId,
      depositToken,
      targetToken,
      depositTokenMeta.decimals,
      targetTokenMeta.decimals,
      usdcPrice,
      targetPrice,
    );

    // Determine best path (highest liquidity)
    const useV2 =
      v2Path.exists &&
      v2Path.liquidityUSD >= MIN_LIQUIDITY_USD &&
      (!v3Path.exists ||
        v2Path.liquidityUSD >= v3Path.liquidityUSD);

    const useV3 =
      v3Path.exists &&
      v3Path.liquidityUSD >= MIN_LIQUIDITY_USD &&
      (!v2Path.exists ||
        v3Path.liquidityUSD > v2Path.liquidityUSD);

    if (!useV2 && !useV3) {
      throw new Error(
        `No valid swap path found between ${depositTokenMeta.symbol} and ${targetTokenMeta.symbol} with sufficient liquidity (min: $${MIN_LIQUIDITY_USD})`,
      );
    }

    if (useV2) {
      // Prepare V2 path
      const router = UNISWAP_V2_ROUTER_ADDRS[chainId];
      if (!router) {
        throw new Error(`Uniswap V2 router not found for chainId ${chainId}`);
      }

      return {
        depositToken: depositToken,
        enabled: true,
        isV2: true,
        router: router,
        quoter: '0x0000000000000000000000000000000000000000', // V2 doesn't use quoter
        pathV2: v2Path.path,
        pathV3: '0x', // Empty bytes for V2
        tokenOut: targetToken,
        slippageBps: slippageBps,
        liquidityUSD: v2Path.liquidityUSD,
      };
    } else {
      // Prepare V3 path
      const router = UNISWAP_V3_ROUTER_ADDRS[chainId];
      const quoter = UNISWAP_V3_QUOTER_ADDRS[chainId];
      if (!router || !quoter) {
        throw new Error(
          `Uniswap V3 router or quoter not found for chainId ${chainId}`,
        );
      }

      // Get WETH address for V3 via paths
      const { ASSETS_ADDRS } = require('src/constants');
      const WETH = ASSETS_ADDRS[chainId]?.WETH;
      if (!WETH) {
        throw new Error(`WETH address not found for chainId ${chainId}`);
      }

      // Encode V3 path
      let pathV3Bytes: string;
      if (v3Path.isDirect && v3Path.fee) {
        pathV3Bytes = this.uniswapV3Resolver.encodeV3Path(
          depositToken,
          v3Path.fee,
          targetToken,
        );
      } else if (v3Path.depositToWethFee && v3Path.wethToTargetFee) {
        pathV3Bytes = this.uniswapV3Resolver.encodeV3Path(
          depositToken,
          v3Path.depositToWethFee,
          WETH as `0x${string}`,
          v3Path.wethToTargetFee,
          targetToken,
        );
      } else {
        throw new Error('Invalid V3 path configuration');
      }

      return {
        depositToken: depositToken,
        enabled: true,
        isV2: false,
        router: router,
        quoter: quoter,
        pathV2: [], // Empty array for V3
        pathV3: pathV3Bytes,
        tokenOut: targetToken,
        slippageBps: slippageBps,
        liquidityUSD: v3Path.liquidityUSD,
      };
    }
  }
}
