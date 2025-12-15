import { Router, Request, Response } from "express"
import WalletHolding from "../models/WalletHolding"
import { calculateWalletTVL } from "../models/utils/WalletHoldingUtils"

const router = Router()

/**
 * Calculate total points accrued from rewards
 */
function calculateTotalPoints(rewards: any[]): bigint {
  return rewards.reduce((total, reward) => {
    return total + (BigInt(reward.amount?.toString() ?? "0"))
  }, 0n)
}

/**
 * GET /api/leaderBoard
 * Returns paginated leaderboard data
 * Query params:
 *   - page: page number (default: 1)
 *   - limit: items per page (default: 10, max: 100)
 *   - sortBy: field to sort by - 'points', 'volume', 'transactions' (default: 'points')
 *   - order: 'asc' or 'desc' (default: 'desc')
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10))
    const sortBy = (req.query.sortBy as string) || "points"
    const order = (req.query.order as string)?.toLowerCase() === "asc" ? 1 : -1

    // Fetch all wallet holdings
    const walletHoldings = await WalletHolding.find().lean()

    // Calculate leaderboard entries with TVL
    const entriesPromises = walletHoldings.map(async (holding) => {
      const totalPointsAccrued = calculateTotalPoints(holding.rewards || [])
      const volumeTradedUSD = holding.volumeTradedUSD || 0
      const transactionsPerformed = holding.transactionsPerformed || 0
      
      // Calculate average transaction size
      const avgTransactionSize = transactionsPerformed > 0 
        ? volumeTradedUSD / transactionsPerformed
        : 0
      
      // Calculate points per transaction
      const pointsPerTransaction = transactionsPerformed > 0
        ? totalPointsAccrued / BigInt(transactionsPerformed)
        : 0n
      
      // Calculate TVL if not set or if deposits exist
      let tvl = holding.tvl || 0
      if ((!tvl || tvl === 0) && holding.deposits && holding.deposits.length > 0) {
        try {
          // Calculate TVL on the fly (function now fetches ETFs from DB using deposit vault addresses)
          tvl = await calculateWalletTVL(holding.deposits as any)
          // Optionally update the wallet in background (don't await)
          WalletHolding.updateOne(
            { _id: holding._id },
            { $set: { tvl } }
          ).catch(err => console.error(`Error updating TVL for wallet ${holding.wallet}:`, err))
        } catch (error) {
          console.error(`Error calculating TVL for wallet ${holding.wallet}:`, error)
        }
      }
      
      return {
        rank: 0, // Will be set after sorting
        address: holding.wallet,
        totalPointsAccrued,
        feesGenerated: 0n, // TODO: Calculate fees if needed
        volumeTradedUSD,
        transactionsPerformed,
        tvl,
        avgTransactionSize,
        pointsPerTransaction,
        lastActivity: holding.updatedAt || null,
      }
    })

    const entries = await Promise.all(entriesPromises)

    // Sort entries based on sortBy parameter
    entries.sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case "volume":
          comparison = a.volumeTradedUSD > b.volumeTradedUSD ? 1 : a.volumeTradedUSD < b.volumeTradedUSD ? -1 : 0
          break
        case "transactions":
          comparison = a.transactionsPerformed - b.transactionsPerformed
          break
        case "points":
        default:
          comparison = a.totalPointsAccrued > b.totalPointsAccrued ? 1 : a.totalPointsAccrued < b.totalPointsAccrued ? -1 : 0
          break
      }
      
      return comparison * order
    })

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1
    })

    // Calculate pagination
    const total = entries.length
    const totalPages = Math.ceil(total / limit)
    const skip = (page - 1) * limit
    const paginatedEntries = entries.slice(skip, skip + limit)

    // Convert BigInt values to strings for JSON response
    const formattedEntries = paginatedEntries.map((entry) => ({
      rank: entry.rank,
      address: entry.address,
      totalPointsAccrued: entry.totalPointsAccrued.toString(),
      feesGenerated: entry.feesGenerated.toString(),
      volumeTradedUSD: entry.volumeTradedUSD.toString(),
      transactionsPerformed: entry.transactionsPerformed,
      tvl: entry.tvl,
      avgTransactionSize: entry.avgTransactionSize.toString(),
      pointsPerTransaction: entry.pointsPerTransaction.toString(),
      lastActivity: entry.lastActivity ? entry.lastActivity.toISOString() : null,
    }))

    return res.json({
      success: true,
      data: formattedEntries,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    })
  } catch (error) {
    console.error("Error fetching leaderboard:", error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
})

export default router

