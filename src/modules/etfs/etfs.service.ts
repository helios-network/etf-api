import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { ETF, ETFDocument } from '../../models/etf.schema';
import { Web3Service } from '../../services/web3.service';
import { EtfResolverService } from '../../services/etf-resolver.service';
import { ChainlinkResolverService } from '../../services/chainlink-resolver.service';
import { ChainId } from '../../config/web3';
import { ETF_CONTRACT_ADDRS, MIN_LIQUIDITY_USD } from '../../constants';
import {
  VerifyResponse,
  VerifySuccessResponse,
  VerifyErrorResponse,
  ComponentVerification,
  PricingMode,
  TokenMetadata,
} from '../../types/etf-verify.types';
import { VerifyEtfDto } from './dto/verify-etf.dto';

@Injectable()
export class EtfsService {
  private readonly logger = new Logger(EtfsService.name);

  constructor(
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
    private readonly cacheService: CacheService,
    private readonly web3Service: Web3Service,
    private readonly etfResolver: EtfResolverService,
    private readonly chainlinkResolver: ChainlinkResolverService,
  ) {}

  async getAll(page: number, size: number, search?: string) {
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

    // Build cache key with all parameters that influence the result
    const cacheKey = `list:page=${page}:size=${size}:search=${normalizedSearch}`;

    // Use cache-aside pattern with 60 seconds TTL
    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        // Calculate skip value
        const skip = (page - 1) * size;

        // Get total count for pagination metadata
        const total = await this.etfModel.countDocuments(searchFilter);

        // Fetch ETFs with pagination
        const etfs = await this.etfModel
          .find(searchFilter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(size)
          .lean()
          .exec();

        // Calculate pagination metadata
        const totalPages = Math.ceil(total / size);
        const hasNextPage = page < totalPages;
        const hasPreviousPage = page > 1;

        return {
          success: true,
          data: etfs,
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

  async verifyETF(body: VerifyEtfDto): Promise<VerifyResponse> {
    // No cache for POST /verify (calculation operation)

    // Validate input
    if (!body.chainId || !body.depositToken || !body.components || !Array.isArray(body.components)) {
      const errorResponse: VerifyErrorResponse = {
        status: 'ERROR',
        reason: 'INVALID_INPUT',
        details: {
          token: '',
          message: 'Missing required fields: chainId, depositToken, or components',
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
    const totalWeight = body.components.reduce((sum, comp) => sum + comp.weight, 0);
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
      depositTokenMetadata = await this.etfResolver.getTokenMetadata(depositToken, chainId);
    } catch (error) {
      const errorResponse: VerifyErrorResponse = {
        status: 'ERROR',
        reason: 'INVALID_INPUT',
        details: {
          token: depositToken,
          message: `Failed to fetch deposit token metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      };
      return errorResponse;
    }

    // Step 1: Find all possible modes for each token
    const tokenModes: Map<string, PricingMode[]> = new Map();
    const tokenMetadataMap: Map<string, TokenMetadata> = new Map();

    let hasDepositTokenInComponents = false;

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
          const metadata = await this.etfResolver.getTokenMetadata(targetToken, chainId);
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
      const allTokensSupportMode = Array.from(tokenModes.values()).every((modes) =>
        modes.includes(mode),
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
          message: 'No common pricing mode found for all tokens. Each token supports different modes.',
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
            message: `Token does not support pricing mode ${commonMode}: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
          encoded: this.etfResolver.encodeV2Paths([emptyAddress, emptyAddress], [emptyAddress, emptyAddress]),
          path: [
            emptyAddress,
            emptyAddress,
          ],
        };
        emptyWithdrawPath = {
          type: 'V2',
          encoded: this.etfResolver.encodeV2Paths([emptyAddress, emptyAddress], [emptyAddress, emptyAddress]),
          path: [
            emptyAddress,
            emptyAddress,
          ],
        };
      } else {
        // V3 paths: empty token0, token1, fee = 0
        const v3ResolutionResult = this.etfResolver.encodeV3ResolutionResult(chainId, {
          exists: false,
          liquidityUSD: -1,
          isDirect: true,
          fee: 100,
        }, emptyAddress, emptyAddress, null);
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
      const depositTokens = await this.etfModel.find({ chain: chainId }).distinct('depositToken');

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
        filteredMetadata = filteredMetadata.filter(
          (metadata) =>
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
}
