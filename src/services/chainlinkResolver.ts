import ChainlinkDataFeed from "../models/ChainlinkDataFeed"
import { ChainlinkFeed } from "../types/etfVerify"

/**
 * Resolve Chainlink feed for a token
 * Searches for TOKEN/USD feed using the path field (e.g., "usdc-usd", "wbtc-usd")
 */
export async function resolveChainlinkFeed(
  tokenSymbol: string,
  chainId: number
): Promise<ChainlinkFeed | null> {
  try {
    // Normalize token symbol to lowercase for path matching
    const normalizedSymbol = tokenSymbol.toLowerCase()
    
    // Search for feed with path matching "token-usd" or "token-usd" pattern
    // The path field contains minified symbols like "usdc-usd", "wbtc-usd"
    const feed = await ChainlinkDataFeed.findOne({
      sourceChain: chainId,
      path: `${normalizedSymbol}-usd`,
      proxyAddress: { $ne: null },
      status: { $ne: "deprecated" }, // Exclude deprecated feeds
    })

    if (!feed || !feed.proxyAddress) {
      return null
    }

    console.log("feed", feed)

    return {
      proxyAddress: feed.proxyAddress,
      path: feed.path,
      pair: feed.pair,
      decimals: feed.decimals,
    }
  } catch (error) {
    console.error(`Error resolving Chainlink feed for ${tokenSymbol}:`, error)
    return null
  }
}

/**
 * Resolve Chainlink feed for USDC (deposit token)
 */
export async function resolveUSDCFeed(chainId: number): Promise<ChainlinkFeed | null> {
  return resolveChainlinkFeed("usdc", chainId)
}

