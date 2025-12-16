export class PortfolioAssetDto {
  chain: number;
  symbol: string;
  etfVaultAddress: string;
  etfTokenAddress: string;
  etfName: string;
  amount: string; // BigInt as string
  amountFormatted: string; // Human readable
  amountUSD: number;
  sharePriceUSD: number;
  decimals: number;
}

