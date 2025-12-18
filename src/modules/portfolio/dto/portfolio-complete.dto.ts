import { PortfolioAssetDto } from './portfolio-asset.dto';

export class AllocationDto {
  symbol: string;
  etfVaultAddress: string;
  amountUSD: number;
  percentage: number;
  chain: number;
}

export class PortfolioCompleteDto {
  address: string;
  totalValueUSD: number;
  totalAssets: number;
  chains: number[];
  updatedAt: Date;
  assets: PortfolioAssetDto[];
  allocation: AllocationDto[];
  byChain: Record<number, number>;
}
