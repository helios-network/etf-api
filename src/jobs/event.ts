import { CronJob } from "cron"
import WalletHolding from "../models/WalletHolding"
import { ChainId, GET_LOGS_BLOCKS, publicClients } from "../config/web3"
import Event from "../models/Event"
import ETF from "../models/ETF"
import ObserveEvents from "../models/ObserveEvents"
import { parseAbi, type PublicClient } from "viem"
import {
  ETF_CONTRACT_ADDRS,
  SUPPORTED_ASSETS,
  DEFAULT_START_BLOCKS,
} from "../constants"
import { fetchVaultConfig, fetchVaultPortfolio, formatTokenAmount, formatUSDValue } from "../models/utils/VaultUtils"
import { calculateWalletTVL } from "../models/utils/WalletHoldingUtils"
import { ethers } from "ethers"

// Constants following the Go code pattern
const ETH_BLOCK_CONFIRMATION_DELAY = 4n // Minimum number of confirmations for a block to be considered valid
const DEFAULT_BLOCKS_TO_SEARCH = 2000n // Maximum block range for event query

// Average block time in milliseconds (Ethereum mainnet ~12s, Arbitrum ~0.25s)
const AVERAGE_BLOCK_TIME_MS: Record<ChainId, bigint> = {
  [ChainId.MAINNET]: 12000n, // 12 seconds
  [ChainId.ARBITRUM]: 250n, // 0.25 seconds
}

// Track missed events block height per chain
const missedEventsBlockHeight: Map<ChainId, bigint> = new Map()

/**
 * Middleware to update wallet TVL after deposit/redeem operations
 */
async function middlewareAfterDeposit(
  shares: bigint,
  walletHolding: InstanceType<typeof WalletHolding>,
  etf: InstanceType<typeof ETF>,
  client: PublicClient
): Promise<void> {

  // Update ETF TVL and share price
  updateETFPortfolio(etf.chain, client, new Set([etf.vault]))

  // Update wallet TVL
  const calculatedTVL = await calculateWalletTVL(walletHolding.deposits)
  walletHolding.tvl = calculatedTVL
  walletHolding.markModified("tvl")

  if (etf.sharePrice != undefined) {
    const depositAmountUSD = etf.sharePrice * Number(ethers.parseUnits(shares.toString(), etf.shareDecimals ?? 18).toString())
    const currentVolume = walletHolding.volumeTradedUSD

    walletHolding.volumeTradedUSD = Number((currentVolume + depositAmountUSD).toFixed(2))
    if (walletHolding.volumeTradedUSD < 0) {
      walletHolding.volumeTradedUSD = 0
    }
    walletHolding.markModified("volumeTradedUSD")
  }
}

async function middlewareAfterRedeem(
  shares: bigint,
  walletHolding: InstanceType<typeof WalletHolding>,
  etf: InstanceType<typeof ETF>,
  client: PublicClient
): Promise<void> {

  // Update ETF TVL and share price
  updateETFPortfolio(etf.chain, client, new Set([etf.vault]))

  // Update wallet TVL
  const calculatedTVL = await calculateWalletTVL(walletHolding.deposits)
  walletHolding.tvl = calculatedTVL
  walletHolding.markModified("tvl")

  if (etf.sharePrice != undefined) {
    const depositAmountUSD = etf.sharePrice * Number(ethers.parseUnits(shares.toString(), etf.shareDecimals ?? 18).toString())
    const currentVolume = walletHolding.volumeTradedUSD

    walletHolding.volumeTradedUSD = Number((currentVolume - depositAmountUSD).toFixed(2))
    if (walletHolding.volumeTradedUSD < 0) {
      walletHolding.volumeTradedUSD = 0
    }
    walletHolding.markModified("volumeTradedUSD")
  }
}

/**
 * Middleware to update transactions and volume before deposit/redeem operations
 */
function middlewareBeforeDepositOrRedeem(
  walletHolding: InstanceType<typeof WalletHolding>,
  // volumeAmount: bigint
): void {
  const currentTransactions = walletHolding.transactionsPerformed ?? 0
  walletHolding.transactionsPerformed = currentTransactions + 1
  walletHolding.markModified("transactionsPerformed")
}

/**
 * Get or create wallet holding from map
 */
function getOrCreateWalletHolding(
  user: string,
  holdingsMap: Map<string, InstanceType<typeof WalletHolding>>
): InstanceType<typeof WalletHolding> {
  let walletHolding = holdingsMap.get(user)
  if (!walletHolding) {
    walletHolding = new WalletHolding({
      wallet: user,
      deposits: [],
      rewards: [],
      transactionsPerformed: 0,
      volumeTradedUSD: 0,
    })
    holdingsMap.set(user, walletHolding)
  }
  return walletHolding
}


/**
 * Find deposit index by chain and vault
 */
function findDepositIndex(
  deposits: Array<{
    chain: number
    etfVaultAddress?: string
    symbol?: string
  }>,
  chainId: ChainId,
  vault: string
): number {
  return deposits.findIndex(
    (deposit) =>
      deposit.chain === Number(chainId) &&
      (deposit.etfVaultAddress === vault ||
       (!deposit.etfVaultAddress && deposit.symbol === vault))
  )
}

/**
 * Create deposit object with ETF metadata
 */
function createDepositObject(
  chainId: ChainId,
  etf: InstanceType<typeof ETF>,
  vault: `0x${string}`,
  amount: bigint
): {
  chain: number
  symbol: string
  decimals: number
  etfVaultAddress: string
  etfTokenAddress: string
  amount: bigint
  amountUSD: number
} {
  return {
    chain: Number(chainId),
    symbol: etf.symbol,
    decimals: etf.shareDecimals ?? 18,
    etfVaultAddress: etf.vault, // Always set vault address
    etfTokenAddress: etf.shareToken,
    amount: amount,
    amountUSD: etf.sharePrice ? etf.sharePrice * Number(ethers.parseUnits(amount.toString(), etf.shareDecimals ?? 18).toString()) : 0,
  }
}

/**
 * Process Deposit event
 */
async function processDepositEvent(
  log: EventLog,
  chainId: ChainId,
  client: PublicClient,
  holdingsMap: Map<string, InstanceType<typeof WalletHolding>>
): Promise<void> {
  const { vault, user, depositAmount, sharesOut } = log.args

  if (!vault || !user || !sharesOut) return

  // Get or create wallet holding
  const walletHolding = getOrCreateWalletHolding(user, holdingsMap)

  // Get ETF from database
  const etf = await ETF.findOne({ vault: vault })

  if (!etf) {
    console.error(`ETF not found for vault ${vault}`)
    return
  }

  // Find existing deposit
  const depositIndex = findDepositIndex(walletHolding.deposits, chainId, vault)

  if (depositIndex !== -1) {
    // Update existing deposit
    const currentAmount = BigInt(walletHolding.deposits[depositIndex].amount?.toString() ?? "0")
    walletHolding.deposits[depositIndex].amount = currentAmount + sharesOut
    
    // Always update metadata if ETF is available (to fix old deposits with wrong symbol)
      walletHolding.deposits[depositIndex].symbol = etf.symbol
      walletHolding.deposits[depositIndex].decimals = etf.shareDecimals ?? 18
      walletHolding.deposits[depositIndex].etfVaultAddress = etf.vault // Ensure vault is set
      walletHolding.deposits[depositIndex].etfTokenAddress = etf.shareToken
    
    walletHolding.markModified("deposits")
  } else {
    // Create new deposit
    const deposit = createDepositObject(chainId, etf, vault, sharesOut)
    walletHolding.deposits.push(deposit)
    walletHolding.markModified("deposits")
  }

  // Apply middlewares
  middlewareBeforeDepositOrRedeem(walletHolding)
  await middlewareAfterDeposit(sharesOut, walletHolding, etf, client)
}

/**
 * Process Redeem event
 */
async function processRedeemEvent(
  log: EventLog,
  chainId: ChainId,
  client: PublicClient,
  holdingsMap: Map<string, InstanceType<typeof WalletHolding>>
): Promise<void> {
  const { vault, user, sharesIn } = log.args

  if (!vault || !user || !sharesIn) return

  // Get or create wallet holding
  const walletHolding = getOrCreateWalletHolding(user, holdingsMap)

  // Get ETF from database
  const etf = await ETF.findOne({ vault: vault })

  if (!etf) {
    console.error(`ETF not found for vault ${vault}`)
    return
  }

  // Find existing deposit
  const depositIndex = findDepositIndex(walletHolding.deposits, chainId, vault)

  if (depositIndex !== -1) {
    // Update existing deposit
    const currentAmount = BigInt(walletHolding.deposits[depositIndex].amount?.toString() ?? "0")
    walletHolding.deposits[depositIndex].amount = currentAmount - sharesIn
    
    // Always update metadata if ETF is available (to fix old deposits with wrong symbol)
    walletHolding.deposits[depositIndex].symbol = etf.symbol
    walletHolding.deposits[depositIndex].decimals = etf.shareDecimals ?? 18
    walletHolding.deposits[depositIndex].etfVaultAddress = etf.vault // Ensure vault is set
    walletHolding.deposits[depositIndex].etfTokenAddress = etf.shareToken
    walletHolding.markModified("deposits")
  } else {
    // Create new deposit (negative amount for redeem)
    const deposit = createDepositObject(chainId, etf, vault, 0n - sharesIn)
    walletHolding.deposits.push(deposit)
    walletHolding.markModified("deposits")
  }

  // Apply middlewares
  middlewareBeforeDepositOrRedeem(walletHolding)
  await middlewareAfterRedeem(sharesIn, walletHolding, etf, client)
}

/**
 * Process ETFCreated event
 */
async function processETFCreatedEvent(
  log: EventLog,
  chainId: ChainId,
  client: PublicClient
): Promise<void> {
  const {
    vault,
    eventNonce,
    eventHeight,
    etfNonce,
    shareToken,
    name,
    symbol,
  } = log.args

  if (!vault) return

  try {
    // Fetch vault configuration from blockchain
    const vaultConfig = await fetchVaultConfig(client, vault)

    // Create new ETF entry with vault configuration
    const etf = new ETF({
      vault: vault,
      chain: Number(chainId),
      shareToken: vaultConfig.shareToken,
      depositToken: vaultConfig.depositToken,
      name: name ?? "",
      symbol: symbol ?? "",
      tvl: "0",
      eventNonce: eventNonce ?? 0n,
      eventHeight: eventHeight ?? 0n,
      etfNonce: etfNonce ?? 0n,
      factory: vaultConfig.factory,
      depositFeed: vaultConfig.depositFeed,
      assets: vaultConfig.assets,
      imbalanceThresholdBps: vaultConfig.imbalanceThresholdBps,
      depositSymbol: vaultConfig.depositSymbol,
      depositDecimals: vaultConfig.depositDecimals,
      shareDecimals: vaultConfig.shareDecimals,
    })

    await etf.save()
    console.log("ETF created:", vault, name, symbol)
  } catch (error) {
    console.error(`Error fetching vault config for ${vault}:`, error)
    // Still create ETF entry with basic info from event
    const etf = new ETF({
      vault: vault,
      chain: Number(chainId),
      shareToken: shareToken ?? "",
      depositToken: "",
      name: name ?? "",
      symbol: symbol ?? "",
      tvl: "0",
      eventNonce: eventNonce ?? 0n,
      eventHeight: eventHeight ?? 0n,
      etfNonce: etfNonce ?? 0n,
    })
    await etf.save()
  }
}

/**
 * Process Rebalance event
 */
async function processRebalanceEvent(
  log: EventLog,
  chainId: ChainId,
  client: PublicClient
): Promise<void> {
  const { vault } = log.args

  if (!vault) return

  // TODO: save liquidity tvl on the etf
}

/**
 * Process ParamsUpdated event
 */
async function processParamsUpdatedEvent(
  log: EventLog,
  chainId: ChainId,
  client: PublicClient
): Promise<void> {
  const { vault } = log.args

  if (!vault) return

  // TODO: handle params update
}

type EventLog = {
  eventName: string
  args: {
    user?: string
    token?: `0x${string}`
    amount?: bigint
    nonce?: bigint
    eventNonce?: bigint
    eventHeight?: bigint
    vault?: `0x${string}`
    depositAmount?: bigint
    sharesOut?: bigint
    sharesIn?: bigint
    depositOut?: bigint
    fromIndex?: bigint
    toIndex?: bigint
    moveValue?: bigint
    bought?: bigint
    imbalanceThresholdBps?: bigint
    maxPriceStaleness?: bigint
    etfNonce?: bigint
    shareToken?: `0x${string}`
    depositToken?: `0x${string}`
    name?: string
    symbol?: string
  }
  blockNumber: bigint
}

/**
 * Get all nonces between lastNonce and currentEventNonce to optimize RPC calls
 */
function getNoncesResearched(lastNonce: bigint, currentEventNonce: bigint): bigint[] {
  const noncesResearched: bigint[] = []
  for (let i = lastNonce + 1n; i <= currentEventNonce; i++) {
    noncesResearched.push(i)
  }
  return noncesResearched
}

/**
 * Filter events by nonce (following Go code pattern)
 */
function filterEvents(events: EventLog[], nonce: bigint): EventLog[] {
  const filtered: EventLog[] = []
  for (const e of events) {
    const eventNonce = e.args.eventNonce ?? e.args.nonce ?? 0n
    if (eventNonce > nonce) {
      filtered.push(e)
    }
  }
  return filtered
}

/**
 * Get factory events from blockchain in order of most likely to be used
 * Stops early if all nonces have been found to optimize RPC calls
 * Following Go code pattern exactly
 */
async function getFactoryEvents(
  client: PublicClient,
  contractAddress: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  lastNonce: bigint,
  noncesResearched: bigint[]
): Promise<EventLog[]> {
  const newEvents: EventLog[] = []
  const noncesFound: bigint[] = []

  // 1. Deposit events (most frequent)
  const depositEvents = await client.getLogs({
    address: contractAddress,
    fromBlock,
    toBlock,
    events: parseAbi([
      "event Deposit(address indexed vault, address user, uint256 depositAmount, uint256 sharesOut, uint256 eventNonce, uint256 eventHeight)",
    ]),
  })

  for (const log of depositEvents) {
    const ev = log as EventLog
    newEvents.push(ev)
    const nonce = ev.args.eventNonce ?? ev.args.nonce ?? 0n
    if (nonce > lastNonce && noncesResearched.includes(nonce)) {
      noncesFound.push(nonce)
    }
  }

  if (noncesFound.length === noncesResearched.length) {
    // All nonces found - gain of 4 calls eth_logs to the ethereum rpc
    console.log("all nonces have been found for events - gain of 4 calls eth_logs to the ethereum rpc")
    return newEvents
  }

  // 2. Redeem events
  const redeemEvents = await client.getLogs({
    address: contractAddress,
    fromBlock,
    toBlock,
    events: parseAbi([
      "event Redeem(address indexed vault, address user, uint256 sharesIn, uint256 depositOut, uint256 eventNonce, uint256 eventHeight)",
    ]),
  })

  for (const log of redeemEvents) {
    const ev = log as EventLog
    newEvents.push(ev)
    const nonce = ev.args.eventNonce ?? ev.args.nonce ?? 0n
    if (nonce > lastNonce && noncesResearched.includes(nonce)) {
      noncesFound.push(nonce)
    }
  }

  if (noncesFound.length === noncesResearched.length) {
    // All nonces found - gain of 3 calls eth_logs to the ethereum rpc
    console.log("all nonces have been found for events - gain of 3 calls eth_logs to the ethereum rpc")
    return newEvents
  }

  // 3. ETFCreated events
  const etfCreatedEvents = await client.getLogs({
    address: contractAddress,
    fromBlock,
    toBlock,
    events: parseAbi([
      "event ETFCreated(address indexed vault, uint256 eventNonce, uint256 eventHeight, uint256 etfNonce, address shareToken, string name, string symbol)",
    ]),
  })

  for (const log of etfCreatedEvents) {
    const ev = log as EventLog
    newEvents.push(ev)
    const nonce = ev.args.eventNonce ?? ev.args.nonce ?? 0n
    if (nonce > lastNonce && noncesResearched.includes(nonce)) {
      noncesFound.push(nonce)
    }
  }

  if (noncesFound.length === noncesResearched.length) {
    // All nonces found - gain of 2 calls eth_logs to the ethereum rpc
    console.log("all nonces have been found for events - gain of 2 calls eth_logs to the ethereum rpc")
    return newEvents
  }

  // 4. Rebalance events
  const rebalanceEvents = await client.getLogs({
    address: contractAddress,
    fromBlock,
    toBlock,
    events: parseAbi([
      "event Rebalance(address indexed vault, uint256 fromIndex, uint256 toIndex, uint256 moveValue, uint256 eventNonce, uint256 eventHeight, uint256 bought)",
    ]),
  })

  for (const log of rebalanceEvents) {
    const ev = log as EventLog
    newEvents.push(ev)
    const nonce = ev.args.eventNonce ?? ev.args.nonce ?? 0n
    if (nonce > lastNonce && noncesResearched.includes(nonce)) {
      noncesFound.push(nonce)
    }
  }

  if (noncesFound.length === noncesResearched.length) {
    // All nonces found - gain of 1 call eth_logs to the ethereum rpc
    console.log("all nonces have been found for events - gain of 1 call eth_logs to the ethereum rpc")
    return newEvents
  }

  // 5. ParamsUpdated events
  const paramsUpdatedEvents = await client.getLogs({
    address: contractAddress,
    fromBlock,
    toBlock,
    events: parseAbi([
      "event ParamsUpdated(address indexed vault, uint256 imbalanceThresholdBps, uint256 maxPriceStaleness, uint256 eventNonce, uint256 eventHeight)",
    ]),
  })

  for (const log of paramsUpdatedEvents) {
    const ev = log as EventLog
    newEvents.push(ev)
  }

  return newEvents
}


/**
 * Save a single event to database
 */
async function saveEvent(log: EventLog, chainId: ChainId): Promise<void> {
  const vault = log.args.vault
  const etf = vault ? await ETF.findOne({ vault: vault }) : undefined
  const depositDecimals = etf?.depositDecimals ?? 18
  const shareTokenDecimals = etf?.shareDecimals ?? 18

  await Event.create({
    type: log.eventName,
    chain: Number(chainId),
    user: log.args.user ?? undefined,
    token: log.args.token ?? undefined,
    amount: log.args.amount ? formatTokenAmount(log.args.amount, 18) : undefined,
    nonce: log.args.eventNonce ?? log.args.nonce ?? 0n,
    blockNumber: log.blockNumber,
    vault: log.args.vault ?? undefined,
    depositAmount: log.args.depositAmount
      ? formatTokenAmount(log.args.depositAmount, depositDecimals)
      : undefined,
    sharesOut: log.args.sharesOut
      ? formatTokenAmount(log.args.sharesOut, shareTokenDecimals)
      : undefined,
    sharesIn: log.args.sharesIn
      ? formatTokenAmount(log.args.sharesIn, shareTokenDecimals)
      : undefined,
    depositOut: log.args.depositOut
      ? formatTokenAmount(log.args.depositOut, depositDecimals)
      : undefined,
    fromIndex: log.args.fromIndex?.toString(),
    toIndex: log.args.toIndex?.toString(),
    moveValue: log.args.moveValue ? formatTokenAmount(log.args.moveValue, 18) : undefined,
    bought: log.args.bought ? formatTokenAmount(log.args.bought, 18) : undefined,
    imbalanceThresholdBps: log.args.imbalanceThresholdBps?.toString(),
    maxPriceStaleness: log.args.maxPriceStaleness?.toString(),
    eventHeight: log.args.eventHeight?.toString(),
    etfNonce: log.args.etfNonce?.toString(),
    shareToken: log.args.shareToken ?? undefined,
    depositToken: log.args.depositToken ?? undefined,
    name: log.args.name ?? undefined,
    symbol: log.args.symbol ?? undefined,
  })
}

/**
 * Save or update a wallet holding
 */
async function saveWalletHolding(
  walletHolding: InstanceType<typeof WalletHolding>,
  existingWalletSet: Set<string>
): Promise<void> {
  const deposits = (walletHolding.deposits || []).map((deposit: any) => ({
    chain: deposit.chain,
    symbol: deposit.symbol,
    decimals: deposit.decimals ?? 18,
    etfVaultAddress: deposit.etfVaultAddress ?? deposit.symbol,
    etfTokenAddress: deposit.etfTokenAddress ?? deposit.etfVaultAddress ?? deposit.symbol,
    amount: deposit.amount ?? 0n,
  }))

  if (existingWalletSet.has(walletHolding.wallet)) {
    // Update existing
    const updateOp: any = {
      $set: {
        deposits,
      },
    }

    if (walletHolding.transactionsPerformed !== undefined) {
      updateOp.$set.transactionsPerformed = walletHolding.transactionsPerformed
    }

    if (walletHolding.volumeTradedUSD !== undefined) {
      updateOp.$set.volumeTradedUSD = walletHolding.volumeTradedUSD
    }

    if (walletHolding.tvl !== undefined) {
      updateOp.$set.tvl = walletHolding.tvl
    }

    await WalletHolding.updateOne(
      { _id: walletHolding._id },
      updateOp
    )
  } else {
    // Insert new
    const doc = walletHolding.toObject ? walletHolding.toObject() : walletHolding
    
    await WalletHolding.create({
      wallet: doc.wallet,
      deposits,
      rewards: [],
      tvl: doc.tvl ?? 0,
      apy: 0,
      transactionsPerformed: doc.transactionsPerformed || 0,
      volumeTradedUSD: doc.volumeTradedUSD || 0,
    })
    existingWalletSet.add(walletHolding.wallet)
  }
}

/**
 * Update observed nonce for a chain
 */
async function updateObservedNonce(
  chainId: ChainId,
  nonce: bigint,
  blockNumber: bigint,
  latestBlock: bigint
): Promise<void> {
  const savedToBlock = blockNumber >= latestBlock ? latestBlock : blockNumber
  
  await ObserveEvents.findOneAndUpdate(
    { chain: Number(chainId) },
    {
      chain: Number(chainId),
      lastBlockNumber: savedToBlock,
      lastNonce: nonce,
    },
    { upsert: true }
  )
}

/**
 * Process events and save them one by one
 */
async function processEvents(
  events: EventLog[],
  chainId: ChainId,
  client: PublicClient,
  holdingsMap: Map<string, InstanceType<typeof WalletHolding>>,
  existingWalletSet: Set<string>,
  latestBlock: bigint
): Promise<void> {
  for (const log of events) {
    try {
      // Process the event
      switch (log.eventName) {
        case "Deposit":
          await processDepositEvent(log, chainId, client, holdingsMap)
          // Save wallet holding if it was modified
          const depositUser = log.args.user
          if (depositUser) {
            const walletHolding = holdingsMap.get(depositUser)
            if (walletHolding) {
              await saveWalletHolding(walletHolding, existingWalletSet)
            }
          }
          break
        case "Redeem":
          await processRedeemEvent(log, chainId, client, holdingsMap)
          // Save wallet holding if it was modified
          const redeemUser = log.args.user
          if (redeemUser) {
            const walletHolding = holdingsMap.get(redeemUser)
            if (walletHolding) {
              await saveWalletHolding(walletHolding, existingWalletSet)
            }
          }
          break
        case "ETFCreated":
          await processETFCreatedEvent(log, chainId, client)
          break
        case "Rebalance":
          await processRebalanceEvent(log, chainId, client)
          break
        case "ParamsUpdated":
          await processParamsUpdatedEvent(log, chainId, client)
          break
        default:
          console.warn(`Unknown event type: ${log.eventName}`)
      }

      // Save the event
      await saveEvent(log, chainId)

      // Update observed nonce after each event
      const eventNonce = log.args.eventNonce ?? log.args.nonce ?? 0n
      await updateObservedNonce(chainId, eventNonce, log.blockNumber, latestBlock)
    } catch (error) {
      console.error(`Error processing event ${log.eventName}:`, error)
      // Continue processing other events even if one fails
    }
  }
}


/**
 * Update ETF portfolio values if not updated in the last minute
 */
async function updateETFPortfolio(
  chainId: ChainId,
  client: PublicClient,
  vaultAddresses: Set<string>
): Promise<void> {
  if (vaultAddresses.size === 0) return

  const oneMinuteAgo = new Date(Date.now() - 60 * 1000)

  // Update each ETF individually
  for (const vaultAddress of vaultAddresses) {
    try {
      // Find ETF that needs updating (not updated in the last minute)
      const etf = await ETF.findOne({
        vault: vaultAddress,
        chain: Number(chainId),
        $or: [
          { updatedAt: { $lt: oneMinuteAgo } },
          { updatedAt: { $exists: false } },
          { volumeTradedUSD: 0 },
          { sharePrice: { $not: { $exists: true } } },
        ],
      })

      if (!etf) {
        continue
      }

      const portfolio = await fetchVaultPortfolio(
        client,
        etf.vault as `0x${string}`,
        etf.shareDecimals
      )

      console.log("Portfolio:", portfolio)

      // Update assets with their TVL values
      const updatedAssets = etf.assets?.map((asset, index) => ({
        token: asset.token,
        feed: asset.feed,
        targetWeightBps: asset.targetWeightBps,
        depositPath: asset.depositPath || [],
        withdrawPath: asset.withdrawPath || [],
        symbol: asset.symbol,
        decimals: asset.decimals,
        tvl: portfolio.valuesPerAsset[index] ?? "0",
      })) ?? []

      // Update ETF
      await ETF.updateOne(
        { _id: etf._id },
        {
          $set: {
            tvl: portfolio.totalValue,
            sharePrice: portfolio.nav,
            assets: updatedAssets,
          },
        }
      )

      console.log(`Updated portfolio for ETF ${etf.vault}: TVL=${portfolio.totalValue}, NAV=${portfolio.nav}`)
    } catch (error) {
      console.error(`Error updating portfolio for ETF ${vaultAddress}:`, error)
    }
  }
}

/**
 * Sync to target height following Go code pattern exactly
 */
async function syncToTargetHeight(
  chainId: ChainId,
  client: PublicClient,
  lastObservedEthHeight: bigint,
  targetHeight: bigint,
  latestHeight: bigint,
  ethBlockConfirmationDelay: bigint
): Promise<{ lastObservedEthHeight: bigint; error?: Error }> {
  if (targetHeight - lastObservedEthHeight === 0n) {
    console.log("No blocks to sync", "last_observed_eth_height", lastObservedEthHeight, "latest_height", latestHeight, "target_height", targetHeight)
    return { lastObservedEthHeight: targetHeight }
  }

  // Get last observed event nonce from ObserveEvents (source of truth, like Helios in Go code)
  const observeProgress = await ObserveEvents.findOne({ chain: Number(chainId) })
  const lastObservedEventNonce = observeProgress?.lastNonce ?? 0n

  // Get latest event nonce from contract
  let latestEventNonce: bigint
  try {
    latestEventNonce = await client.readContract({
      address: ETF_CONTRACT_ADDRS[chainId] as `0x${string}`,
      abi: parseAbi(["function state_lastEventNonce() view returns (uint256)"]),
      functionName: "state_lastEventNonce",
    }) as bigint
  } catch (error: any) {
    if (error?.message?.includes("no contract code")) {
      console.error("No contract code at given address, rotating RPC might be needed")
    }
    console.error("failed to get last event nonce on chain", chainId, error)
    return { lastObservedEthHeight, error: error as Error }
  }

  // Skip optimization: if nonces match, skip RPC calls
  if (!missedEventsBlockHeight.has(chainId) || missedEventsBlockHeight.get(chainId) === 0n) {
    if (lastObservedEventNonce === latestEventNonce) {
      console.log("lastObservedEventNonce is equal to latestEventNonce, no new events to process")
      return { lastObservedEthHeight: targetHeight }
    } else {
      // Special case to reduce the number of calls to the ethereum rpc
      // We can miss events if we don't rewind few minutes
      // blockTimeOnTheChain is in milliseconds
      const blockTimeOnTheChain = AVERAGE_BLOCK_TIME_MS[chainId]

      // compute number of blocks in 2 minutes
      const twoMinutesMs = 2n * 60n * 1000n // 120000 ms

      const nbBlocksToRewind = twoMinutesMs / blockTimeOnTheChain

      console.log("rewinding the last observed height by", nbBlocksToRewind, "blocks")
      // rewind the last observed height
      lastObservedEthHeight = lastObservedEthHeight > nbBlocksToRewind 
        ? lastObservedEthHeight - nbBlocksToRewind 
        : 0n
    }
  }

  // Get all nonces between lastObservedEventNonce and latestEventNonce to optimize the number of calls to the ethereum rpc
  const noncesResearched = getNoncesResearched(lastObservedEventNonce, latestEventNonce)

  console.log("noncesResearched:", noncesResearched)

  const contractAddress = ETF_CONTRACT_ADDRS[chainId] as `0x${string}`

  // Get events from blockchain
  let events: EventLog[]
  try {
    events = await getFactoryEvents(
      client,
      contractAddress,
      lastObservedEthHeight,
      targetHeight,
      lastObservedEventNonce,
      noncesResearched
    )
  } catch (error) {
    console.error("failed to get events on chain", chainId, error)
    return { lastObservedEthHeight, error: error as Error }
  }

  console.log("events Before Filter", events.length)
  const newEvents = filterEvents(events, lastObservedEventNonce)
  console.log("newEvents:", newEvents.length)

  // Sort events by nonce
  newEvents.sort((a, b) => {
    const nonceA = a.args.eventNonce ?? a.args.nonce ?? 0n
    const nonceB = b.args.eventNonce ?? b.args.nonce ?? 0n
    return nonceA < nonceB ? -1 : nonceA > nonceB ? 1 : 0
  })

  if (newEvents.length === 0) {
    console.log("oracle no new events on chain", chainId, "eth_block_start", lastObservedEthHeight, "eth_block_end", targetHeight)
    return { lastObservedEthHeight: targetHeight }
  }

  if (newEvents.length > 0) {
    console.log("SOME EVENTS DETECTED", newEvents.length)
  }

  // Check for missed events (nonce gap detection)
  const firstEventNonce = newEvents[0].args.eventNonce ?? newEvents[0].args.nonce ?? 0n
  if (firstEventNonce > lastObservedEventNonce + 1n) {
    // we missed an event
    const observeProgress = await ObserveEvents.findOne({ chain: Number(chainId) })
    const lastObservedHeight = observeProgress?.lastBlockNumber ?? DEFAULT_START_BLOCKS[chainId]

    // if we missed an event, we need to rewind the last observed height by 5 minutes and continue from there
    if (!missedEventsBlockHeight.has(chainId) || missedEventsBlockHeight.get(chainId) === 0n) {
      missedEventsBlockHeight.set(chainId, lastObservedHeight)
    } else {
      // blockTimeOnTheChain is in milliseconds
      const blockTimeOnTheChain = AVERAGE_BLOCK_TIME_MS[chainId]

      // compute number of blocks in 5 minutes
      const fiveMinutesMs = 5n * 60n * 1000n // 300000 ms

      const nbBlocksToRewind = fiveMinutesMs / blockTimeOnTheChain

      const currentMissedHeight = missedEventsBlockHeight.get(chainId) ?? lastObservedHeight
      missedEventsBlockHeight.set(chainId, currentMissedHeight > nbBlocksToRewind 
        ? currentMissedHeight - nbBlocksToRewind 
        : 0n)
    }

    const rewindHeight = missedEventsBlockHeight.get(chainId) ?? lastObservedHeight
    console.log("orchestrator missed an event on chain", chainId, ". Restarting block search from last observed claim...", {
      current_helios_nonce: lastObservedEventNonce,
      wanted_nonce: lastObservedEventNonce + 1n,
      actual_ethereum_nonce: firstEventNonce,
      rewind_height: rewindHeight
    })
    return { lastObservedEthHeight: rewindHeight, error: new Error("missed an event") }
  }

  // Clear missed events block height since we found events in sequence
  missedEventsBlockHeight.set(chainId, 0n)

  // Collect all unique wallet addresses
  const walletAddresses = new Set<string>()
  for (const log of newEvents) {
    const user = log.args.user
    if (user) walletAddresses.add(user)
  }

  // Fetch all existing wallet holdings in one query
  const existingHoldings = await WalletHolding.find({
    wallet: { $in: Array.from(walletAddresses) },
  })
  const holdingsMap = new Map<string, InstanceType<typeof WalletHolding>>()
  const existingWalletSet = new Set<string>()
  for (const holding of existingHoldings) {
    holdingsMap.set(holding.wallet, holding)
    existingWalletSet.add(holding.wallet)
  }

  // Process all events one by one, saving each immediately
  await processEvents(newEvents, chainId, client, holdingsMap, existingWalletSet, latestHeight)

  return { lastObservedEthHeight: targetHeight }
}

/**
 * Observe and process lending events for a specific chain
 * Following Go code pattern exactly
 */
async function observeEvents(chainId: ChainId, client: PublicClient): Promise<void> {
  if (DEFAULT_START_BLOCKS[chainId] == 0n) return

  // Get or create observe progress for this chain
  let observeProgress = await ObserveEvents.findOne({ chain: Number(chainId) })
  
  // Get last event for nonce tracking
  const lastEventObserved = await Event.findOne({
    chain: Number(chainId),
  }).sort({ blockNumber: -1, nonce: -1 })

  // Determine starting block number (lastObservedEthHeight)
  let lastObservedEthHeight: bigint
  if (observeProgress) {
    // Use saved progress
    lastObservedEthHeight = observeProgress.lastBlockNumber
  } else {
    // First time: use last event block or default start block
    lastObservedEthHeight = lastEventObserved?.blockNumber ?? DEFAULT_START_BLOCKS[chainId]
  }

  // Get latest block number
  let latestHeight: bigint
  try {
    latestHeight = await client.getBlockNumber()
  } catch (error) {
    console.error("failed to get latest height on chain", chainId, error)
    return
  }

  // Ensure that latest block has minimum confirmations
  const ethBlockConfirmationDelay = ETH_BLOCK_CONFIRMATION_DELAY
  let targetHeight = latestHeight

  // not enough blocks on ethereum yet
  if (targetHeight <= ethBlockConfirmationDelay) {
    console.log("not enough blocks on chain", chainId)
    return
  }

  // ensure that latest block has minimum confirmations
  targetHeight = targetHeight - ethBlockConfirmationDelay
  
  if (targetHeight <= lastObservedEthHeight) {
    console.log("Synced", lastObservedEthHeight, "to", targetHeight)
    return
  }

  // Sync in chunks following Go code pattern
  const defaultBlocksToSearch = DEFAULT_BLOCKS_TO_SEARCH
  let targetHeightForSync = targetHeight

  for (let i = 0; i < 100 && latestHeight > targetHeightForSync; i++) {
    if (targetHeightForSync > lastObservedEthHeight + defaultBlocksToSearch) {
      targetHeightForSync = lastObservedEthHeight + defaultBlocksToSearch
    }

    const result = await syncToTargetHeight(
      chainId,
      client,
      lastObservedEthHeight,
      targetHeightForSync,
      latestHeight,
      ethBlockConfirmationDelay
    )

    if (result.error) {
      if (result.error.message === "missed an event") {
        // Restart from rewinded height
        lastObservedEthHeight = result.lastObservedEthHeight
        // Continue the loop to retry
        continue
      } else {
        // Other errors, return
        console.error("Error in syncToTargetHeight:", result.error)
        return
      }
    }

    lastObservedEthHeight = result.lastObservedEthHeight
    targetHeightForSync = targetHeightForSync + defaultBlocksToSearch
  }

  // Save progress to database
  const finalLastEvent = await Event.findOne({
    chain: Number(chainId),
  }).sort({ blockNumber: -1, nonce: -1 })
  
  const finalNonce = finalLastEvent?.nonce ?? 0n
  const savedToBlock = lastObservedEthHeight >= latestHeight ? latestHeight : lastObservedEthHeight

  await ObserveEvents.findOneAndUpdate(
    { chain: Number(chainId) },
    {
      chain: Number(chainId),
      lastBlockNumber: savedToBlock,
      lastNonce: finalNonce,
    },
    { upsert: true }
  )
}

// Mutex to prevent concurrent execution of the cron job
let isRunning = false
let startup = false

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



    if (!startup) { // Only run once on startup (to advance the last observed height if no new events were found)
      startup = true
      for (const [chainId, client] of Object.entries(publicClients)) {
        let observeProgress = await ObserveEvents.findOne({ chain: Number(chainId) })
        if (!observeProgress) {
          continue
        }
        const lastEventNonce = await client.readContract({
          address: ETF_CONTRACT_ADDRS[Number(chainId) as ChainId] as `0x${string}`,
          abi: parseAbi(["function state_lastEventNonce() view returns (uint256)"]),
          functionName: "state_lastEventNonce",
        }) as bigint

        if (lastEventNonce <= observeProgress.lastNonce) {
          let latestObservedHeight = await client.getBlockNumber()
          ObserveEvents.findOneAndUpdate({ chain: Number(chainId) }, {
            $set: {
              lastBlockNumber: latestObservedHeight,
              lastNonce: lastEventNonce,
            },
          }, { upsert: true })
        }
      }
    }

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
