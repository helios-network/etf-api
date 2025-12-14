import { parseAbi, type PublicClient, encodeFunctionData, decodeFunctionResult, erc20Abi } from "viem"

/**
 * Fetch vault configuration from blockchain
 */
export async function fetchVaultConfig(
  client: PublicClient,
  vaultAddress: `0x${string}`
): Promise<{
  factory: string
  depositToken: string
  depositFeed: string
  shareToken: string
  assets: Array<{
    token: string
    // feed: string
    targetWeightBps: number
    // depositPath: string[]
    // withdrawPath: string[]
    symbol?: string
    decimals?: number
  }>
  imbalanceThresholdBps: bigint
  depositSymbol: string
  depositDecimals: number
  shareDecimals: number
}> {
  const vaultAbi = parseAbi([
    "function factory() view returns (address)",
    "function depositToken() view returns (address)",
    "function depositFeed() view returns (address)",
    "function shareToken() view returns (address)",
    "function assetCount() view returns (uint256)",
    "function imbalanceThresholdBps() view returns (uint256)",
  ])

  const [factory, depositToken, depositFeed, shareToken, assetsLength, imbalanceThresholdBps] =
    await Promise.all([
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "factory",
      }),
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "depositToken",
      }),
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "depositFeed",
      }),
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "shareToken",
      }),
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "assetCount",
      }),
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "imbalanceThresholdBps",
      }),
    ])

  const raw = await client.call({
    to: vaultAddress,
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "getAssets",
          inputs: [],
          outputs: [
            {
              type: "tuple[]",
              components: [
                { name: "token", type: "address" },
                { name: "feed", type: "address" },
                { name: "targetWeightBps", type: "uint256" }, // <— uint256 pour decode
                { name: "depositPath", type: "address[]" },
                { name: "withdrawPath", type: "address[]" },
              ]
            }
          ],
          stateMutability: "view",
        }
      ],
      functionName: "getAssets",
      args: [],
    }),
  })

  if (!raw.data) {
    throw new Error("No data returned")
  }

  const assetsResults = decodeFunctionResult({
    abi: [
      {
        type: "function",
        name: "getAssets",
        inputs: [],
        outputs: [
          { type: "tuple[]", components: [
            { name: "token", type: "address" },
            { name: "targetWeightBps", type: "uint256" },
          ] }
        ],
        stateMutability: "view",
      }
    ],
    data: raw.data,
  })
  
  const assets = assetsResults.map((asset: any) => ({
    token: asset.token as string,
    // feed: asset.feed as string,
    targetWeightBps: Number(asset.targetWeightBps),
    // depositPath: asset.depositPath as string[],
    // withdrawPath: asset.withdrawPath as string[],
  }))

  // Fetch symbol and decimals for each asset token
  const assetDetailsPromises = assets.map(async (asset) => {
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({
          address: asset.token as `0x${string}`,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        client.readContract({
          address: asset.token as `0x${string}`,
          abi: erc20Abi,
          functionName: "decimals",
        }),
      ])
      return {
        ...asset,
        symbol: symbol as string,
        decimals: Number(decimals),
      }
    } catch (error) {
      console.error(`Error fetching token details for ${asset.token}:`, error)
      // Return asset without symbol/decimals if fetch fails
      return asset
    }
  })

  const assetsWithDetails = await Promise.all(assetDetailsPromises)

  // Fetch symbol and decimals for depositToken
  let depositSymbol = ""
  let depositDecimals = 0
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({
        address: depositToken as `0x${string}`,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      client.readContract({
        address: depositToken as `0x${string}`,
        abi: erc20Abi,
        functionName: "decimals",
      }),
    ])
    depositSymbol = symbol as string
    depositDecimals = Number(decimals)
  } catch (error) {
    console.error(`Error fetching depositToken details for ${depositToken}:`, error)
  }

  // Fetch decimals for shareToken
  let shareDecimals = 18 // Default to 18
  try {
    const decimals = await client.readContract({
      address: shareToken as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    })
    shareDecimals = Number(decimals)
  } catch (error) {
    console.error(`Error fetching shareToken decimals for ${shareToken}:`, error)
  }

  return {
    factory: factory as string,
    depositToken: depositToken as string,
    depositFeed: depositFeed as string,
    shareToken: shareToken as string,
    assets: assetsWithDetails,
    imbalanceThresholdBps: imbalanceThresholdBps as bigint,
    depositSymbol,
    depositDecimals,
    shareDecimals,
  }
}

/**
 * Convert BigInt to string with decimals rounding
 */
export function formatTokenAmount(amount: bigint | undefined, decimals: number): string | undefined {
  if (amount === undefined || amount === null) return undefined
  if (decimals === 0) return amount.toString()
  
  const divisor = BigInt(10 ** decimals)
  const wholePart = amount / divisor
  const fractionalPart = amount % divisor
  
  if (fractionalPart === 0n) {
    return wholePart.toString()
  }
  
  // Convert fractional part to decimal string with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
  // Remove trailing zeros
  const trimmedFractional = fractionalStr.replace(/0+$/, '')
  
  if (trimmedFractional === '') {
    return wholePart.toString()
  }
  
  return `${wholePart}.${trimmedFractional}`
}

/**
 * Format BigInt value with 18 decimals (for USD values)
 */
export function formatUSDValue(value: bigint): string {
  return formatTokenAmount(value, 18) ?? "0"
}

/**
 * Fetch portfolio value and NAV from vault contract
 */
export async function fetchVaultPortfolio(
  client: PublicClient,
  vaultAddress: `0x${string}`,
  shareDecimals?: number
): Promise<{
  totalValue: string
  valuesPerAsset: string[]
  nav: string
}> {
  const vaultAbi = parseAbi([
    "function getPortfolioValue() view returns (uint256 totalValue, uint256[] valuesPerAsset)",
    "function getNAV() view returns (uint256 nav)",
  ])

  const [portfolioResult, nav] = await Promise.all([
    client.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "getPortfolioValue",
    }),
    client.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "getNAV",
    }),
  ])

  const totalValue = portfolioResult[0] as bigint
  const valuesPerAsset = portfolioResult[1] as bigint[]

  // NAV is returned with shareDecimals, not always 18
  // Use shareDecimals if provided, otherwise default to 18
  const navDecimals = shareDecimals ?? 18
  const navFormatted = formatTokenAmount(nav, navDecimals) ?? "0"

  return {
    totalValue: formatUSDValue(totalValue),
    valuesPerAsset: valuesPerAsset.map((value) => formatUSDValue(value)),
    nav: navFormatted,
  }
}
