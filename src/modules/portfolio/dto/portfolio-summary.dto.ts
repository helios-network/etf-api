export class AllocationDto {
  symbol: string;
  etfVaultAddress: string;
  amountUSD: number;
  percentage: number;
  chain: number;
}

export class PortfolioSummaryDto {
  address: string;
  totalValueUSD: number;
  totalAssets: number;
  allocation: AllocationDto[];
  byChain: Record<number, number>;
}

