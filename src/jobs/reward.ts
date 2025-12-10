import { CronJob } from "cron"
import LeaderBoardRewards from "../models/LeaderBoardRewards"
import WalletHolding from "../models/WalletHolding"

const BATCH_SIZE = 1000 // Number of documents to process per batch

/**
 * Calculate the timestamp of the start of the current day (midnight)
 */
function getCurrentTime(): number {
  return Math.floor(Date.now() / (1000 * 60 * 60 * 24)) * (1000 * 60 * 60 * 24)
}

/**
 * Get the active pool reward for the given date
 */
async function getActivePoolReward(currentTime: number) {
  return await LeaderBoardRewards.findOne({
    startDate: { $lte: currentTime },
    endDate: { $gte: currentTime },
  })
}

/**
 * Build the MongoDB query to find wallets with holdings
 */
function buildQuery(type: string, chain: number, symbol: string) {
  return {
    [type]: {
      $elemMatch: {
        chain,
        symbol,
        amount: { $gt: 0n },
      },
    },
  }
}

/**
 * Calculate the daily reward based on the total duration of the pool
 */
function calculateDailyReward(poolReward: any): bigint {
  const daysDuration = Math.floor(
    (poolReward.endDate - poolReward.startDate) / (1000 * 60 * 60 * 24)
  )
  return poolReward.totalReward.quantity / BigInt(daysDuration)
}

/**
 * Get the amount of a wallet for a given type, chain and symbol
 */
function getWalletAmount(
  walletHolding: any,
  type: string,
  chain: number,
  symbol: string
): bigint {
  return (
    walletHolding?.[type]?.find(
      (item: any) => item.chain === chain && item.symbol === symbol
    )?.amount ?? 0n
  )
}

/**
 * Calculate the total parts in batches
 * (first pass to know the total before distribution)
 */
async function calculateTotalParts(
  query: any,
  type: string,
  chain: number,
  symbol: string
): Promise<bigint> {
  let totalParts = 0n
  let skip = 0
  let hasMore = true

  while (hasMore) {
    const walletHoldings = await WalletHolding.find(query)
      .skip(skip)
      .limit(BATCH_SIZE)
      .lean()

    if (walletHoldings.length === 0) {
      break
    }

    for (const walletHolding of walletHoldings) {
      const amount = getWalletAmount(walletHolding, type, chain, symbol)
      if (amount === 0n) continue; // Skip wallets with no amount
      totalParts += amount
    }

    skip += BATCH_SIZE
    hasMore = walletHoldings.length === BATCH_SIZE
  }

  return totalParts
}

/**
 * Distribute the rewards in batches
 * (second pass to update the wallets)
 */
async function distributeRewards(
  query: any,
  type: string,
  chain: number,
  symbol: string,
  dailyReward: bigint,
  totalParts: bigint,
  currentTime: number
): Promise<void> {
  let skip = 0
  let hasMore = true

  while (hasMore) {
    const walletHoldings = await WalletHolding.find(query)
      .skip(skip)
      .limit(BATCH_SIZE)

    if (walletHoldings.length === 0) {
      break
    }

    const bulkOps = walletHoldings.map((walletHolding) => {
      const amount = getWalletAmount(walletHolding, type, chain, symbol)
      if (amount === 0n) return undefined; // Skip wallets with no amount

      const rewardAmount = (dailyReward * amount) / totalParts

      return {
        updateOne: {
          filter: { _id: walletHolding._id },
          update: {
            $push: {
              rewards: {
                chain,
                symbol,
                amount: rewardAmount,
                date: currentTime,
              },
            },
          },
        },
      }
    })

    if (bulkOps.length > 0) {
      await WalletHolding.bulkWrite(bulkOps.filter((op) => op !== undefined))
    }

    skip += BATCH_SIZE
    hasMore = walletHoldings.length === BATCH_SIZE
  }
}

/**
 * Main function that orchestrates the reward distribution process
 */
async function processDailyRewards(): Promise<void> {
  // const currentTime = getCurrentTime()

  // const poolReward = await getActivePoolReward(currentTime)
  // if (!poolReward) return

  // const type = poolReward.type === "deposit" ? "deposits" : "borrows"
  // const query = buildQuery(type, poolReward.chain, poolReward.symbol)
  // const dailyReward = calculateDailyReward(poolReward)

  // // First pass: calculate the total parts
  // const totalParts = await calculateTotalParts(
  //   query,
  //   type,
  //   poolReward.chain,
  //   poolReward.symbol
  // )

  // if (totalParts === 0n) return

  // // Second pass: distribute the rewards
  // await distributeRewards(
  //   query,
  //   type,
  //   poolReward.chain,
  //   poolReward.symbol,
  //   dailyReward,
  //   totalParts,
  //   currentTime
  // )
}

new CronJob("0 0 0 * * *", processDailyRewards, null, true)
