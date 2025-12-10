import { Router, Request, Response } from "express"
import WalletHolding from "../models/WalletHolding"

const router = Router()

interface LeaderBoardEntry {
  rank: number
  address: string
  totalPointsAccrued: bigint
  feesGenerated: bigint
  volumeTraded: bigint
  transactionsPerformed: number
}

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

    // Calculate leaderboard entries
    const entries: LeaderBoardEntry[] = walletHoldings.map((holding) => {
      const totalPointsAccrued = calculateTotalPoints(holding.rewards || [])
      
      return {
        rank: 0, // Will be set after sorting
        address: holding.wallet,
        totalPointsAccrued,
        feesGenerated: 0n, // TODO: Calculate fees if needed
        volumeTraded: BigInt(holding.volumeTraded?.toString() ?? "0"),
        transactionsPerformed: holding.transactionsPerformed || 0,
      }
    })

    // Sort entries based on sortBy parameter
    entries.sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case "volume":
          comparison = a.volumeTraded > b.volumeTraded ? 1 : a.volumeTraded < b.volumeTraded ? -1 : 0
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
      volumeTraded: entry.volumeTraded.toString(),
      transactionsPerformed: entry.transactionsPerformed,
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

