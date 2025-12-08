import { CronJob } from "cron"
import WalletHolding from "../models/WalletHolding"
import { ChainId, GET_LOGS_BLOCKS, publicClients } from "../config/web3"
import Event from "../models/Event"
import { parseAbi, type PublicClient } from "viem"
import {
  LENDING_CONTRACT_ADDRS,
  SUPPORTED_ASSETS,
  DEFAULT_START_BLOCKS,
} from "../constants"

type EventLog = {
  eventName: string
  args: {
    user?: string
    token?: `0x${string}`
    amount?: bigint
    nonce?: bigint
    liquidator?: `0x${string}`
    collateralToken?: `0x${string}`
    collateralAmount?: bigint
    debtToken?: `0x${string}`
    debtRepaid?: bigint
  }
  blockNumber: bigint
}

/**
 * Get all nonces between lastNonce and currentEventNonce to optimize RPC calls
 */
function getNoncesResearched(lastNonce: bigint, currentEventNonce: bigint): Set<bigint> {
  const noncesResearched = new Set<bigint>()
  for (let i = lastNonce + 1n; i <= currentEventNonce; i++) {
    noncesResearched.add(i)
  }
  return noncesResearched
}

/**
 * Get lending events from blockchain in order of most likely to be used
 * Stops early if all nonces have been found to optimize RPC calls
 */
async function getLendingEvents(
  client: PublicClient,
  contractAddress: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  lastNonce: bigint,
  noncesResearched: Set<bigint>
): Promise<EventLog[]> {
  const newEvents: EventLog[] = []
  const noncesFound = new Set<bigint>()

  // 1. Deposited events (most frequent)
  const depositedEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event Deposited(address indexed user, address indexed token, uint256 amount, uint256 nonce)",
      ]),
    })
  ).filter((log: any) => (log.args.nonce ?? 0n) > lastNonce)

  for (const log of depositedEvents) {
    newEvents.push(log as EventLog)
    const nonce = (log as any).args.nonce ?? 0n
    if (nonce > lastNonce && noncesResearched.has(nonce)) {
      noncesFound.add(nonce)
    }
  }

  if (noncesFound.size === noncesResearched.size) {
    // All nonces found - gain of 4 calls eth_logs to the ethereum rpc
    return newEvents
  }

  // 2. Borrowed events
  const borrowedEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event Borrowed(address indexed user, address indexed token, uint256 amount, uint256 nonce)",
      ]),
    })
  ).filter((log: any) => (log.args.nonce ?? 0n) > lastNonce)

  for (const log of borrowedEvents) {
    newEvents.push(log as EventLog)
    const nonce = (log as any).args.nonce ?? 0n
    if (nonce > lastNonce && noncesResearched.has(nonce)) {
      noncesFound.add(nonce)
    }
  }

  if (noncesFound.size === noncesResearched.size) {
    // All nonces found - gain of 3 calls eth_logs to the ethereum rpc
    return newEvents
  }

  // 3. Withdrawn events
  const withdrawnEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event Withdrawn(address indexed user, address indexed token, uint256 amount, uint256 nonce)",
      ]),
    })
  ).filter((log: any) => (log.args.nonce ?? 0n) > lastNonce)

  for (const log of withdrawnEvents) {
    newEvents.push(log as EventLog)
    const nonce = (log as any).args.nonce ?? 0n
    if (nonce > lastNonce && noncesResearched.has(nonce)) {
      noncesFound.add(nonce)
    }
  }

  if (noncesFound.size === noncesResearched.size) {
    // All nonces found - gain of 2 calls eth_logs to the ethereum rpc
    return newEvents
  }

  // 4. Repaid events
  const repaidEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event Repaid(address indexed user, address indexed token, uint256 amount, uint256 nonce)",
      ]),
    })
  ).filter((log: any) => (log.args.nonce ?? 0n) > lastNonce)

  for (const log of repaidEvents) {
    newEvents.push(log as EventLog)
    const nonce = (log as any).args.nonce ?? 0n
    if (nonce > lastNonce && noncesResearched.has(nonce)) {
      noncesFound.add(nonce)
    }
  }

  if (noncesFound.size === noncesResearched.size) {
    // All nonces found - gain of 1 call eth_logs to the ethereum rpc
    return newEvents
  }

  // 5. Liquidated events (least frequent)
  const liquidatedEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event Liquidated(address indexed liquidator, address indexed user, address indexed collateralToken, uint256 collateralAmount, address debtToken, uint256 debtRepaid, uint256 nonce)",
      ]),
    })
  ).filter((log: any) => (log.args.nonce ?? 0n) > lastNonce)

  for (const log of liquidatedEvents) {
    newEvents.push(log as EventLog)
  }

  return newEvents
}

/**
 * Process events and update wallet holdings in memory
 */
function processEvents(
  events: EventLog[],
  chainId: ChainId,
  holdingsMap: Map<string, InstanceType<typeof WalletHolding>>
): void {
  for (const log of events) {
    if (log.eventName === "Deposited") {
      const { user, token, amount } = log.args

      const asset = SUPPORTED_ASSETS[chainId].find(
        (item) => item.address.toLowerCase() === token?.toLowerCase()
      )
      if (!asset || !token) continue

      const userLower = user?.toLowerCase()
      if (!userLower) continue

      let walletHolding = holdingsMap.get(userLower)
      if (!walletHolding) {
        walletHolding = new WalletHolding({
          wallet: user,
          deposits: [],
          borrows: [],
          rewards: [],
        })
        holdingsMap.set(userLower, walletHolding)
      }

      const depositIndex = walletHolding.deposits.findIndex(
        (deposit) =>
          deposit.chain === Number(chainId) &&
          deposit.symbol.toLowerCase() === token.toLowerCase()
      )
      if (depositIndex !== -1) {
        walletHolding.deposits[depositIndex].amount =
          walletHolding.deposits[depositIndex].amount + (amount ?? 0n)
      } else {
        walletHolding.deposits.push({
          chain: Number(chainId),
          symbol: token,
          amount: amount ?? 0n,
        })
      }
    } else if (log.eventName === "Withdrawn") {
      const { user, token, amount } = log.args
      if (!token) continue

      const userLower = user?.toLowerCase()
      if (!userLower) continue

      let walletHolding = holdingsMap.get(userLower)
      if (!walletHolding) {
        walletHolding = new WalletHolding({
          wallet: user,
          deposits: [],
          borrows: [],
          rewards: [],
        })
        holdingsMap.set(userLower, walletHolding)
      }

      const depositIndex = walletHolding.deposits.findIndex(
        (deposit) =>
          deposit.chain === Number(chainId) &&
          deposit.symbol.toLowerCase() === token.toLowerCase()
      )
      if (depositIndex !== -1) {
        walletHolding.deposits[depositIndex].amount =
          walletHolding.deposits[depositIndex].amount - (amount ?? 0n)
      } else {
        walletHolding.deposits.push({
          chain: Number(chainId),
          symbol: token,
          amount: 0n - (amount ?? 0n),
        })
      }
    } else if (log.eventName === "Borrowed") {
      const { user, token, amount } = log.args
      if (!token) continue

      const userLower = user?.toLowerCase()
      if (!userLower) continue

      let walletHolding = holdingsMap.get(userLower)
      if (!walletHolding) {
        walletHolding = new WalletHolding({
          wallet: user,
          deposits: [],
          borrows: [],
          rewards: [],
        })
        holdingsMap.set(userLower, walletHolding)
      }

      const borrowIndex = walletHolding.borrows.findIndex(
        (borrow) =>
          borrow.chain === Number(chainId) &&
          borrow.symbol.toLowerCase() === token.toLowerCase()
      )
      if (borrowIndex !== -1) {
        walletHolding.borrows[borrowIndex].amount =
          walletHolding.borrows[borrowIndex].amount + (amount ?? 0n)
      } else {
        walletHolding.borrows.push({
          chain: Number(chainId),
          symbol: token,
          amount: amount ?? 0n,
        })
      }
    } else if (log.eventName === "Repaid") {
      const { user, token, amount } = log.args
      if (!token) continue

      const userLower = user?.toLowerCase()
      if (!userLower) continue

      let walletHolding = holdingsMap.get(userLower)
      if (!walletHolding) {
        walletHolding = new WalletHolding({
          wallet: user,
          deposits: [],
          borrows: [],
          rewards: [],
        })
        holdingsMap.set(userLower, walletHolding)
      }

      const borrowIndex = walletHolding.borrows.findIndex(
        (borrow) =>
          borrow.chain === Number(chainId) &&
          borrow.symbol.toLowerCase() === token.toLowerCase()
      )
      if (borrowIndex !== -1) {
        walletHolding.borrows[borrowIndex].amount =
          walletHolding.borrows[borrowIndex].amount - (amount ?? 0n)
      } else {
        walletHolding.borrows.push({
          chain: Number(chainId),
          symbol: token,
          amount: 0n - (amount ?? 0n),
        })
      }
    } else if (log.eventName === "Liquidated") {
      const {
        user,
        collateralToken,
        collateralAmount,
        debtToken,
        debtRepaid,
      } = log.args
      if (!collateralToken || !debtToken) continue

      const userLower = user?.toLowerCase()
      if (!userLower) continue

      let walletHolding = holdingsMap.get(userLower)
      if (!walletHolding) {
        walletHolding = new WalletHolding({
          wallet: user,
          deposits: [],
          borrows: [],
          rewards: [],
        })
        holdingsMap.set(userLower, walletHolding)
      }

      const borrowIndex = walletHolding.borrows.findIndex(
        (borrow) =>
          borrow.chain === Number(chainId) &&
          borrow.symbol.toLowerCase() === debtToken.toLowerCase()
      )
      if (borrowIndex !== -1) {
        walletHolding.borrows[borrowIndex].amount =
          walletHolding.borrows[borrowIndex].amount - (debtRepaid ?? 0n)
      } else {
        walletHolding.borrows.push({
          chain: Number(chainId),
          symbol: debtToken,
          amount: 0n - (debtRepaid ?? 0n),
        })
      }

      const depositIndex = walletHolding.deposits.findIndex(
        (deposit) =>
          deposit.chain === Number(chainId) &&
          deposit.symbol.toLowerCase() === collateralToken.toLowerCase()
      )
      if (depositIndex !== -1) {
        walletHolding.deposits[depositIndex].amount =
          walletHolding.deposits[depositIndex].amount -
          (collateralAmount ?? 0n)
      } else {
        walletHolding.deposits.push({
          chain: Number(chainId),
          symbol: collateralToken,
          amount: 0n - (collateralAmount ?? 0n),
        })
      }
    }
  }
}

/**
 * Save events and wallet holdings to database
 */
async function saveEventsAndHoldings(
  events: EventLog[],
  chainId: ChainId,
  holdingsMap: Map<string, InstanceType<typeof WalletHolding>>,
  existingWalletSet: Set<string>
): Promise<void> {
  // Build bulk operations for wallet holdings
  const bulkOps: any[] = []
  for (const [walletLower, walletHolding] of holdingsMap.entries()) {
    if (existingWalletSet.has(walletLower)) {
      // Update existing
      bulkOps.push({
        updateOne: {
          filter: { _id: walletHolding._id },
          update: {
            $set: {
              deposits: walletHolding.deposits,
              borrows: walletHolding.borrows,
            },
          },
        },
      })
    } else {
      // Insert new - convert Mongoose document to plain object
      const doc = walletHolding.toObject
        ? walletHolding.toObject()
        : walletHolding
      bulkOps.push({
        insertOne: {
          document: {
            wallet: doc.wallet,
            deposits: doc.deposits || [],
            borrows: doc.borrows || [],
            rewards: [],
            tvl: 0,
            apy: 0,
          },
        },
      })
    }
  }

  // Execute bulk write
  if (bulkOps.length > 0) {
    await WalletHolding.bulkWrite(bulkOps)
  }

  // Save events
  await Event.insertMany(
    events.map((log) => ({
      type: log.eventName,
      chain: Number(chainId),
      user: log.args.user as string,
      token: log.args.token ?? undefined,
      amount: log.args.amount ?? undefined,
      nonce: log.args.nonce ?? 0n,
      blockNumber: log.blockNumber,
      liquidator: log.args.liquidator ?? undefined,
      collateralToken: log.args.collateralToken ?? undefined,
      collateralAmount: log.args.collateralAmount ?? undefined,
      debtToken: log.args.debtToken ?? undefined,
      debtRepaid: log.args.debtRepaid ?? undefined,
    }))
  )
}

/**
 * Observe and process lending events for a specific chain
 */
async function observeEvents(chainId: ChainId, client: PublicClient): Promise<void> {
  const lastEvent = await Event.findOne({
    chain: Number(chainId),
  }).sort({ blockNumber: -1, nonce: -1 })

  const lastBlockNumber =
    lastEvent?.blockNumber ??
    DEFAULT_START_BLOCKS[chainId]
  const lastNonce = lastEvent?.nonce ?? 0n

  const currentEventNonce = await client.readContract({
    address: LENDING_CONTRACT_ADDRS[chainId] as `0x${string}`,
    abi: parseAbi(["function lastEventNonce() view returns (uint256)"]),
    functionName: "lastEventNonce",
  })

  if (currentEventNonce <= lastNonce) return

  // Get all nonces between lastNonce and currentEventNonce to optimize RPC calls
  const noncesResearched = getNoncesResearched(lastNonce, currentEventNonce)

  const contractAddress = LENDING_CONTRACT_ADDRS[chainId] as `0x${string}`
  const fromBlock = lastBlockNumber
  const toBlock = lastBlockNumber + GET_LOGS_BLOCKS[chainId]

  // Get events from blockchain
  const newEvents = await getLendingEvents(
    client,
    contractAddress,
    fromBlock,
    toBlock,
    lastNonce,
    noncesResearched
  )

  if (newEvents.length === 0) return

  // Collect all unique wallet addresses
  const walletAddresses = new Set<string>()
  for (const log of newEvents) {
    const user = log.args.user
    if (user) walletAddresses.add(user.toLowerCase())
  }

  // Fetch all existing wallet holdings in one query
  const existingHoldings = await WalletHolding.find({
    wallet: { $in: Array.from(walletAddresses) },
  })
  const holdingsMap = new Map<string, InstanceType<typeof WalletHolding>>()
  const existingWalletSet = new Set<string>()
  for (const holding of existingHoldings) {
    const walletLower = holding.wallet.toLowerCase()
    holdingsMap.set(walletLower, holding)
    existingWalletSet.add(walletLower)
  }

  // Process all events and update in-memory objects
  processEvents(newEvents, chainId, holdingsMap)

  // Save events and holdings to database
  await saveEventsAndHoldings(newEvents, chainId, holdingsMap, existingWalletSet)
}

// Mutex to prevent concurrent execution of the cron job
let isRunning = false

new CronJob(
  "*/12 * * * * *",
  async () => {
    // Check if job is already running
    if (isRunning) {
      console.log("Event job is already running, skipping this execution")
      return
    }

    // Set mutex flag
    isRunning = true

    try {
      await Promise.all(
        Object.entries(publicClients).map(async ([chainId, client]) => {
          await observeEvents(Number(chainId) as ChainId, client)
        })
      )
    } catch (error) {
      console.error("Error in event job:", error)
    } finally {
      // Always release mutex flag
      isRunning = false
    }
  },
  null,
  true
)
