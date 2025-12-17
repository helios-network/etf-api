import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from '../../infrastructure/cache/cache.service';
import {
  WalletHolding,
  WalletHoldingDocument,
} from '../../models/wallet-holding.schema';
import { ETF, ETFDocument } from '../../models/etf.schema';
import { PortfolioResponseDto } from './dto/portfolio-response.dto';
import { PortfolioAssetDto } from './dto/portfolio-asset.dto';
import { PortfolioSummaryDto, AllocationDto } from './dto/portfolio-summary.dto';
import { normalizeEthAddress } from '../../common/utils/eip55';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    @InjectModel(WalletHolding.name)
    private walletHoldingModel: Model<WalletHoldingDocument>,
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
    private readonly cacheService: CacheService,
  ) {}


  /**
   * Enrich deposit with ETF metadata
   */
  private enrichDepositWithETF(
    deposit: {
      chain: number;
      symbol: string;
      decimals: number;
      etfVaultAddress: string;
      etfTokenAddress: string;
      amount: string;
      amountUSD: number;
    },
    etf: ETF | null,
  ): PortfolioAssetDto {
    const decimals = deposit.decimals ?? etf?.shareDecimals ?? 18;
    const amountBigInt = BigInt(deposit.amount || '0');
    const divisor = BigInt(10 ** decimals);
    const wholePart = amountBigInt / divisor;
    const fractionalPart = amountBigInt % divisor;
    const fractionalDecimal = Number(fractionalPart) / Number(divisor);
    const amountFormatted = (Number(wholePart) + fractionalDecimal)
      .toFixed(decimals)
      .replace(/\.?0+$/, '');

    return {
      chain: deposit.chain,
      symbol: deposit.symbol,
      etfVaultAddress: deposit.etfVaultAddress,
      etfTokenAddress: deposit.etfTokenAddress,
      etfName: etf?.name || deposit.symbol,
      amount: deposit.amount,
      amountFormatted,
      amountUSD: deposit.amountUSD || 0,
      sharePriceUSD: etf?.sharePrice || 0,
      decimals,
    };
  }

  /**
   * Calculate allocation percentages from assets
   */
  private calculateAllocation(
    assets: PortfolioAssetDto[],
  ): AllocationDto[] {
    const totalUSD = assets.reduce((sum, asset) => sum + asset.amountUSD, 0);
    
    if (totalUSD === 0) {
      return [];
    }

    // Group by symbol + vault to handle same symbol on different chains
    const grouped = new Map<string, { amountUSD: number; chain: number; symbol: string; etfVaultAddress: string }>();
    
    for (const asset of assets) {
      const key = `${asset.symbol}-${asset.etfVaultAddress}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.amountUSD += asset.amountUSD;
      } else {
        grouped.set(key, {
          amountUSD: asset.amountUSD,
          chain: asset.chain,
          symbol: asset.symbol,
          etfVaultAddress: asset.etfVaultAddress,
        });
      }
    }

    return Array.from(grouped.values()).map((item) => ({
      symbol: item.symbol,
      etfVaultAddress: item.etfVaultAddress,
      amountUSD: item.amountUSD,
      percentage: (item.amountUSD / totalUSD) * 100,
      chain: item.chain,
    }));
  }

  /**
   * Get portfolio overview for a wallet
   */
  async getPortfolio(address: string): Promise<{
    success: boolean;
    data?: PortfolioResponseDto;
    message?: string;
  }> {
    const normalizedAddress = normalizeEthAddress(address);
    const cacheKey = `portfolio:summary:${normalizedAddress}`;

    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        const walletHolding = await this.walletHoldingModel
          .findOne({
            wallet: normalizedAddress,
          })
          .lean()
          .exec();

        if (!walletHolding) {
          return {
            success: false,
            message: 'Wallet not found',
          };
        }

        const deposits = walletHolding.deposits || [];
        const totalValueUSD = deposits.reduce(
          (sum, deposit) => sum + (deposit.amountUSD || 0),
          0,
        );
        const chains = [...new Set(deposits.map((d) => d.chain))];

        return {
          success: true,
          data: {
            address: normalizedAddress,
            totalValueUSD,
            totalAssets: deposits.length,
            chains,
            updatedAt: walletHolding.updatedAt || walletHolding.createdAt || new Date(),
          },
        };
      },
      {
        namespace: 'portfolio',
        ttl: 45, // 45 seconds
      },
    );
  }

  /**
   * Get detailed assets list for a wallet
   */
  async getPortfolioAssets(
    address: string,
    chain?: number,
    symbol?: string,
  ): Promise<{
    success: boolean;
    data?: PortfolioAssetDto[];
    message?: string;
  }> {
    const normalizedAddress = normalizeEthAddress(address);
    // Cache key includes filters to differentiate cached results
    const cacheKey = `portfolio:assets:${normalizedAddress}:chain=${chain || 'all'}:symbol=${symbol || 'all'}`;

    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        const walletHolding = await this.walletHoldingModel
          .findOne({
            wallet: normalizedAddress,
          })
          .lean()
          .exec();

        if (!walletHolding) {
          return {
            success: false,
            message: 'Wallet not found',
          };
        }

        let deposits = walletHolding.deposits || [];

        // Apply filters
        if (chain !== undefined) {
          deposits = deposits.filter((d) => d.chain === chain);
        }
        if (symbol !== undefined) {
          deposits = deposits.filter((d) => d.symbol === symbol);
        }

        if (deposits.length === 0) {
          return {
            success: true,
            data: [],
          };
        }

        // Extract unique vault addresses
        const vaultAddresses = [
          ...new Set(deposits.map((d) => normalizeEthAddress(d.etfVaultAddress))),
        ];

        // Fetch all ETFs in one query
        const etfs = await this.etfModel
          .find({
            vault: { $in: vaultAddresses },
          })
          .lean()
          .exec();

        // Create Map for O(1) lookup
        const etfMap = new Map<string, ETF>(
          etfs.map((etf) => [normalizeEthAddress(etf.vault), etf]),
        );

        // Enrich deposits with ETF data
        const enrichedAssets = deposits.map((deposit) => {
          const normalizedVaultAddress = normalizeEthAddress(deposit.etfVaultAddress);
          const etf = etfMap.get(normalizedVaultAddress) || null;
          return this.enrichDepositWithETF(deposit, etf);
        });

        return {
          success: true,
          data: enrichedAssets,
        };
      },
      {
        namespace: 'portfolio',
        ttl: 45, // 45 seconds
      },
    );
  }

  /**
   * Get portfolio summary with allocation
   */
  async getPortfolioSummary(address: string): Promise<{
    success: boolean;
    data?: PortfolioSummaryDto;
    message?: string;
  }> {
    const normalizedAddress = normalizeEthAddress(address);
    const cacheKey = `portfolio:summary:${normalizedAddress}`;

    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        const walletHolding = await this.walletHoldingModel
          .findOne({
            wallet: normalizedAddress,
          })
          .lean()
          .exec();

        if (!walletHolding) {
          return {
            success: false,
            message: 'Wallet not found',
          };
        }

        const deposits = walletHolding.deposits || [];

        if (deposits.length === 0) {
          return {
            success: true,
            data: {
              address: normalizedAddress,
              totalValueUSD: 0,
              totalAssets: 0,
              allocation: [],
              byChain: {},
            },
          };
        }

        // Extract unique vault addresses
        const vaultAddresses = [
          ...new Set(deposits.map((d) => normalizeEthAddress(d.etfVaultAddress))),
        ];

        // Fetch all ETFs in one query
        const etfs = await this.etfModel
          .find({
            vault: { $in: vaultAddresses },
          })
          .lean()
          .exec();

        // Create Map for O(1) lookup
        const etfMap = new Map<string, ETF>(
          etfs.map((etf) => [normalizeEthAddress(etf.vault), etf]),
        );

        // Enrich deposits with ETF data
        const enrichedAssets = deposits.map((deposit) => {
          const normalizedVaultAddress = normalizeEthAddress(deposit.etfVaultAddress);
          const etf = etfMap.get(normalizedVaultAddress) || null;
          return this.enrichDepositWithETF(deposit, etf);
        });

        const totalValueUSD = enrichedAssets.reduce(
          (sum, asset) => sum + asset.amountUSD,
          0,
        );

        // Calculate allocation
        const allocation = this.calculateAllocation(enrichedAssets);

        // Calculate by chain
        const byChain: Record<number, number> = {};
        for (const asset of enrichedAssets) {
          byChain[asset.chain] = (byChain[asset.chain] || 0) + asset.amountUSD;
        }

        return {
          success: true,
          data: {
            address: normalizedAddress,
            totalValueUSD,
            totalAssets: deposits.length,
            allocation,
            byChain,
          },
        };
      },
      {
        namespace: 'portfolio',
        ttl: 45, // 45 seconds
      },
    );
  }
}

