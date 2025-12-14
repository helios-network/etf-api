import { CronJob } from "cron"
import ChainlinkDataFeed from "../models/ChainlinkDataFeed"

const ETHEREUM_CHAIN_ID = 1
const ARBITRUM_CHAIN_ID = 42161

const ETHEREUM_FEEDS_URL =
  "https://reference-data-directory.vercel.app/feeds-mainnet.json"
const ARBITRUM_FEEDS_URL =
  "https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-arbitrum-1.json"

interface ChainlinkFeed {
  compareOffchain: string
  contractAddress: string
  contractType: string
  contractVersion: number
  decimalPlaces: number | null
  ens: string | null
  formatDecimalPlaces: number | null
  healthPrice: string
  history: boolean | null
  multiply: string
  name: string
  pair: string[]
  path: string
  proxyAddress: string | null
  threshold: number
  valuePrefix: string
  assetName: string
  feedCategory: string
  feedType: string
  docs: any
  decimals: number
  feedId?: string
  sourceChain: number
  status: string
  oracles: Array<{ operator: string }>
  heartbeat?: number
}

/**
 * Fetch feeds from the API
 */
async function fetchFeeds(url: string): Promise<ChainlinkFeed[]> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch feeds: ${response.statusText}`)
    }
    return (await response.json()) as ChainlinkFeed[]
  } catch (error) {
    console.error(`Error fetching feeds from ${url}:`, error)
    throw error
  }
}

/**
 * Process and save feeds for a specific chain
 */
async function processFeedsForChain(
  chainId: number,
  url: string
): Promise<void> {
  try {
    console.log(
      `[Chainlink Sync] Starting sync for chain ${chainId} from ${url}`
    )

    const feeds = await fetchFeeds(url)
    console.log(
      `[Chainlink Sync] Fetched ${feeds.length} feeds for chain ${chainId}`
    )

    let addedCount = 0
    let skippedCount = 0

    for (const feed of feeds) {
      try {

        if (!feed.proxyAddress) {
          continue
        }
        
        // Check if feed already exists
        const existingFeed = await ChainlinkDataFeed.findOne({ proxyAddress: feed.proxyAddress })

        if (existingFeed) {
          // Update existing feed
          const updateQuery = { proxyAddress: feed.proxyAddress }
          
          await ChainlinkDataFeed.updateOne(
            updateQuery,
            {
              $set: {
                compareOffchain: feed.compareOffchain || "",
                contractAddress: feed.contractAddress || "",
                contractType: feed.contractType || "",
                contractVersion: feed.contractVersion ?? 0,
                decimalPlaces: feed.decimalPlaces,
                ens: feed.ens,
                formatDecimalPlaces: feed.formatDecimalPlaces,
                history: feed.history,
                multiply: feed.multiply || "",
                name: feed.name || "",
                pair: feed.pair || [],
                path: feed.path || "",
                proxyAddress: feed.proxyAddress,
                threshold: feed.threshold ?? 0,
                valuePrefix: feed.valuePrefix || "",
                assetName: feed.assetName || "",
                feedCategory: feed.feedCategory || "",
                feedType: feed.feedType || "",
                docs: feed.docs || {},
                decimals: feed.decimals ?? 0,
                sourceChain: feed.sourceChain || chainId,
                status: feed.status || "",
                oracles: feed.oracles || [],
                heartbeat: feed.heartbeat,
              },
            }
          )
          skippedCount++
        } else {
          // Insert new feed
          await ChainlinkDataFeed.create({
            compareOffchain: feed.compareOffchain || "",
            contractAddress: feed.contractAddress || "",
            contractType: feed.contractType || "",
            contractVersion: feed.contractVersion ?? 0,
            decimalPlaces: feed.decimalPlaces,
            ens: feed.ens,
            formatDecimalPlaces: feed.formatDecimalPlaces,
            healthPrice: feed.healthPrice || "",
            history: feed.history,
            multiply: feed.multiply || "",
            name: feed.name || "",
            pair: feed.pair || [],
            path: feed.path || "",
            proxyAddress: feed.proxyAddress,
            threshold: feed.threshold ?? 0,
            valuePrefix: feed.valuePrefix || "",
            assetName: feed.assetName || "",
            feedCategory: feed.feedCategory || "",
            feedType: feed.feedType || "",
            docs: feed.docs || {},
            decimals: feed.decimals ?? 0,
            feedId: feed.feedId || null,
            sourceChain: feed.sourceChain || chainId,
            status: feed.status || "",
            oracles: feed.oracles || [],
            heartbeat: feed.heartbeat,
          })
          addedCount++
        }
      } catch (error) {
        const identifier = feed.feedId || `${feed.path}-${feed.sourceChain || chainId}`
        console.error(
          `[Chainlink Sync] Error processing feed ${feed.name} (${identifier}):`,
          error
        )
        skippedCount++
      }
    }

    console.log(
      `[Chainlink Sync] Chain ${chainId} sync completed: ${addedCount} added, ${skippedCount} skipped/updated`
    )
  } catch (error) {
    console.error(
      `[Chainlink Sync] Error processing feeds for chain ${chainId}:`,
      error
    )
  }
}

/**
 * Main function to sync all Chainlink feeds
 */
export async function syncChainlinkFeeds(): Promise<void> {
  console.log("[Chainlink Sync] Starting daily sync of Chainlink feeds")

  try {
    // Process Ethereum feeds
    await processFeedsForChain(ETHEREUM_CHAIN_ID, ETHEREUM_FEEDS_URL)

    // Process Arbitrum feeds
    await processFeedsForChain(ARBITRUM_CHAIN_ID, ARBITRUM_FEEDS_URL)

    console.log("[Chainlink Sync] Daily sync completed successfully")
  } catch (error) {
    console.error("[Chainlink Sync] Error during daily sync:", error)
    throw error
  }
}

// Create cron job that runs every day at midnight (00:00:00)
// Cron format: second minute hour day month dayOfWeek
// "0 0 0 * * *" = every day at 00:00:00
new CronJob("0 0 0 * * *", syncChainlinkFeeds, null, true)

console.log("✅ Chainlink feeds sync job scheduled (runs daily at midnight)")

