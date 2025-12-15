import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from '../../infrastructure/cache/cache.service';
import { ETF, ETFDocument } from '../../models/etf.schema';
import { Web3Service } from '../../services/web3.service';
import { EtfResolverService } from '../../services/etf-resolver.service';
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
  ) {}

  async getAll(page: number, size: number) {
    // Validate pagination parameters
    if (page < 1) {
      throw new Error('Page must be greater than 0');
    }

    if (size < 1 || size > 100) {
      throw new Error('Size must be between 1 and 100');
    }

    // Calculate skip value
    const skip = (page - 1) * size;

    // Get total count for pagination metadata
    const total = await this.etfModel.countDocuments();

    // Fetch ETFs with pagination
    const etfs = await this.etfModel
      .find()
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
      depositTokenMetadata = await this.etfResolver.getTokenMetadata(client, depositToken);
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

    for (const component of body.components) {
      const targetToken = component.token as `0x${string}`;

      // Skip if target token is the same as deposit token (case-insensitive comparison)
      if (targetToken.toLowerCase() === depositToken.toLowerCase()) {
        continue;
      }

      try {
        // Get target token metadata
        const targetTokenMetadata = await this.etfResolver.getTokenMetadata(
          client,
          targetToken,
        );
        tokenMetadataMap.set(targetToken, targetTokenMetadata);

        // Find all possible modes for this token
        const possibleModes = await this.etfResolver.findPossibleModes(
          client,
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
          const metadata = await this.etfResolver.getTokenMetadata(client, targetToken);
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

      // Skip if target token is the same as deposit token
      if (targetToken.toLowerCase() === depositToken.toLowerCase()) {
        continue;
      }

      try {
        const targetTokenMetadata = tokenMetadataMap.get(targetToken)!;

        // Resolve token with the common mode
        const resolution = await this.etfResolver.resolveTokenWithMode(
          client,
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

    // All components verified successfully
    const successResponse: VerifySuccessResponse = {
      status: 'OK',
      readyForCreation: true,
      factoryAddress: ETF_CONTRACT_ADDRS[chainId],
      components: componentVerifications,
    };

    return successResponse;
  }

  async getDepositTokens() {
    try {
      // Get all distinct deposit tokens
      const depositTokens = await this.etfModel.distinct('depositToken');

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
      const client = this.web3Service.getPublicClient(ChainId.MAINNET);
      if (!client) {
        throw new Error('Mainnet client not available');
      }

      const depositTokenMetadata = await Promise.all(
        validDepositTokens.map(async (token) => {
          try {
            const metadata = await this.etfResolver.getTokenMetadata(
              client,
              token as `0x${string}`,
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

      return {
        success: true,
        data: depositTokenMetadata,
      };
    } catch (error) {
      this.logger.error('Error fetching deposit tokens:', error);
      throw error;
    }
  }
}
