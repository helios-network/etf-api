import ETF from "../ETF"

/**
 * Calculate wallet TVL from deposits
 * TVL = sum of (shares × NAV) for all deposits
 * Each deposit's ETF is fetched from the database using its etfVaultAddress
 */
export async function calculateWalletTVL(
  deposits: Array<{
    chain: number
    symbol: string
    decimals?: number
    etfVaultAddress?: string
    etfTokenAddress?: string
    amount: bigint
  }>
): Promise<number> {
  if (!deposits || deposits.length === 0) {
    return 0
  }

  let totalTVL = 0

  // Calculate TVL for each deposit
  for (const deposit of deposits) {
    // Skip deposits with zero or negative amount
    const sharesAmount = BigInt(deposit.amount?.toString() ?? "0")
    if (sharesAmount <= 0n) {
      continue
    }

    // Use etfVaultAddress which should be set on deposit creation
    const vaultAddress = deposit.etfVaultAddress
    if (!vaultAddress) {
      continue
    }

    // Get ETF from database using the vault address from the deposit
    const etf = await ETF.findOne({ vault: vaultAddress })

    if (!etf) {
      // ETF not found, skip this deposit
      continue
    }

    // Parse sharePrice (stored as formatted string)
    const sharePriceUSD = etf.sharePrice
    if (sharePriceUSD == undefined || sharePriceUSD <= 0) {
      continue
    }

    // Get the decimals for the shares
    const depositDecimals = deposit.decimals ?? etf.shareDecimals ?? 18
    
    // Convert shares from raw units to human-readable units
    const sharesInHumanReadable = Number(sharesAmount) / Math.pow(10, depositDecimals)

    // Calculate value: shares (human-readable) × sharePrice (USD)
    const depositValueUSD = sharesInHumanReadable * sharePriceUSD
    totalTVL += depositValueUSD
  }

  return totalTVL
}

