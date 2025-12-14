import { type PublicClient, erc20Abi, encodeAbiParameters, encodePacked } from "viem"
import { MIN_LIQUIDITY_USD } from "../constants"
import { resolveChainlinkFeed, resolveUSDCFeed } from "./chainlinkResolver"
import { findV2Path } from "./uniswapV2Resolver"
import { findBestV3Pool, encodeV3Path } from "./uniswapV3Resolver"
import {
  TokenMetadata,
  ResolutionResult,
  PricingMode,
  DepositPath,
  WithdrawPath,
} from "../types/etfVerify"

/**
 * Get token metadata (symbol, decimals) from blockchain
 */
export async function getTokenMetadata(
  client: PublicClient,
  tokenAddress: `0x${string}`
): Promise<TokenMetadata> {
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "decimals",
      }),
    ])

    return {
      address: tokenAddress,
      symbol: symbol as string,
      decimals: Number(decimals),
    }
  } catch (error) {
    throw new Error(`Failed to fetch token metadata for ${tokenAddress}: ${error}`)
  }
}

/**
 * Get price from Chainlink feed
 */
export async function getChainlinkPrice(
  client: PublicClient,
  feedAddress: `0x${string}`,
  decimals: number
): Promise<number | null> {
  try {
    const priceFeedAbi = [
      {
        type: "function",
        name: "latestRoundData",
        inputs: [],
        outputs: [
          { name: "roundId", type: "uint80" },
          { name: "answer", type: "int256" },
          { name: "startedAt", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
          { name: "answeredInRound", type: "uint80" },
        ],
        stateMutability: "view",
      },
    ] as const

    const result = await client.readContract({
      address: feedAddress,
      abi: priceFeedAbi,
      functionName: "latestRoundData",
    })

    const answer = result[1] as bigint
    return Number(answer) / 10 ** decimals
  } catch (error) {
    console.error(`Error fetching Chainlink price from ${feedAddress}:`, error)
    return null
  }
}

/**
 * Encode V2 paths for deposit/withdraw
 * Format: encode(["address[]", "address[]"], [depositPath, withdrawPath])
 */
function encodeV2Paths(depositPath: string[], withdrawPath: string[]): string {
  return encodeAbiParameters(
    [{ type: "address[]" }, { type: "address[]" }],
    [depositPath as `0x${string}`[], withdrawPath as `0x${string}`[]]
  )
}

/**
 * Main resolution function - follows strict pipeline order
 */
export async function resolveToken(
  client: PublicClient,
  depositToken: `0x${string}`,
  targetToken: `0x${string}`,
  chainId: number,
  depositTokenMetadata: TokenMetadata,
  targetTokenMetadata: TokenMetadata
): Promise<ResolutionResult> {
  // Get USDC feed for pricing
  const usdcFeed = await resolveUSDCFeed(chainId)
  const usdcPrice = usdcFeed
    ? await getChainlinkPrice(client, usdcFeed.proxyAddress as `0x${string}`, usdcFeed.decimals)
    : null

  // Try Mode 1: V2 + Chainlink Feed
  let targetFeed = await resolveChainlinkFeed(targetTokenMetadata.symbol, chainId)
  console.log("targetFeed", targetFeed)

  if (!targetFeed && targetTokenMetadata.symbol.startsWith("W")) { // wrapped token
    const wrappedToken = await resolveChainlinkFeed(targetTokenMetadata.symbol.slice(1), chainId)
    if (wrappedToken) {
      targetFeed = wrappedToken
    }
  }

  if (targetFeed) {
    const targetPrice = await getChainlinkPrice(
      client,
      targetFeed.proxyAddress as `0x${string}`,
      targetFeed.decimals
    )

    if (targetPrice) {
      const v2Path = await findV2Path(
        client,
        depositToken,
        targetToken,
        depositTokenMetadata.decimals,
        targetTokenMetadata.decimals,
        usdcPrice,
        targetPrice
      )

      if (v2Path.exists && v2Path.liquidityUSD >= MIN_LIQUIDITY_USD) {
        const withdrawPath = [...v2Path.path].reverse()
        const encoded = encodeV2Paths(v2Path.path, withdrawPath)

        return {
          pricingMode: "V2_PLUS_FEED",
          feed: targetFeed,
          depositPath: {
            type: "V2",
            encoded: encoded,
            path: v2Path.path,
          },
          withdrawPath: {
            type: "V2",
            encoded: encoded,
            path: withdrawPath,
          },
          liquidityUSD: v2Path.liquidityUSD,
        }
      }
    }
  }

  // Try Mode 2: V3 + Chainlink Feed
  if (targetFeed) {
    const targetPrice = await getChainlinkPrice(
      client,
      targetFeed.proxyAddress as `0x${string}`,
      targetFeed.decimals
    )

    if (targetPrice) {
      const v3Pool = await findBestV3Pool(
        client,
        depositToken,
        targetToken,
        depositTokenMetadata.decimals,
        targetTokenMetadata.decimals,
        usdcPrice,
        targetPrice
      )

      if (v3Pool.exists && v3Pool.liquidityUSD >= MIN_LIQUIDITY_USD) {
        const v3PathBytes = encodeV3Path(
          depositToken,
          v3Pool.fee,
          targetToken
        )
        // For V3: encode(["bytes", "uint24"], [v3Path, fee])
        const encoded = encodeAbiParameters(
          [{ type: "bytes" }, { type: "uint24" }],
          [v3PathBytes as `0x${string}`, v3Pool.fee]
        )

        return {
          pricingMode: "V3_PLUS_FEED",
          feed: targetFeed,
          depositPath: {
            type: "V3",
            encoded: encoded,
            token0: depositToken,
            token1: targetToken,
            fee: v3Pool.fee,
          },
          withdrawPath: {
            type: "V3",
            encoded: encoded,
            token0: targetToken,
            token1: depositToken,
            fee: v3Pool.fee,
          },
          liquidityUSD: v3Pool.liquidityUSD,
        }
      }
    }
  }

  // Try Mode 3: V2 + V2 (DEX-only)
  const v2Path = await findV2Path(
    client,
    depositToken,
    targetToken,
    depositTokenMetadata.decimals,
    targetTokenMetadata.decimals,
    usdcPrice,
    null // No feed, use DEX pricing
  )

  if (v2Path.exists && v2Path.liquidityUSD >= MIN_LIQUIDITY_USD) {
    const withdrawPath = [...v2Path.path].reverse()
    const encoded = encodeV2Paths(v2Path.path, withdrawPath)

    return {
      pricingMode: "V2_PLUS_V2",
      feed: null,
      depositPath: {
        type: "V2",
        encoded: encoded,
        path: v2Path.path,
      },
      withdrawPath: {
        type: "V2",
        encoded: encoded,
        path: withdrawPath,
      },
      liquidityUSD: v2Path.liquidityUSD,
    }
  }

  // Try Mode 4: V3 + V3 (last resort)
  const v3Pool = await findBestV3Pool(
    client,
    depositToken,
    targetToken,
    depositTokenMetadata.decimals,
    targetTokenMetadata.decimals,
    usdcPrice,
    null // No feed, use DEX pricing
  )

  if (v3Pool.exists && v3Pool.liquidityUSD >= MIN_LIQUIDITY_USD) {
    const v3PathBytes = encodeV3Path(
      depositToken,
      v3Pool.fee,
      targetToken
    )
    // For V3: encode(["bytes", "uint24"], [v3Path, fee])
    const encoded = encodeAbiParameters(
      [{ type: "bytes" }, { type: "uint24" }],
      [v3PathBytes as `0x${string}`, v3Pool.fee]
    )

    return {
      pricingMode: "V3_PLUS_V3",
      feed: null,
      depositPath: {
        type: "V3",
        encoded: encoded,
        token0: depositToken,
        token1: targetToken,
        fee: v3Pool.fee,
      },
      withdrawPath: {
        type: "V3",
        encoded: encoded,
        token0: targetToken,
        token1: depositToken,
        fee: v3Pool.fee,
      },
      liquidityUSD: v3Pool.liquidityUSD,
    }
  }

  // No valid mode found
  throw new Error(
    `No valid pricing mode found for token ${targetTokenMetadata.symbol}. Insufficient liquidity or no pools available.`
  )
}

