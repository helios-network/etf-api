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
    const sharePrice = parseFloat(etf.sharePrice)
    const depositAmountUSD = sharePrice * Number(ethers.parseUnits(shares.toString(), etf.shareDecimals ?? 18).toString())
    const currentVolume = Number(walletHolding.volumeTraded?.toString() ?? "0")

    walletHolding.volumeTraded = (currentVolume + depositAmountUSD).toFixed(2)
    walletHolding.markModified("volumeTraded")

    etf.volumeTradedUSD = (Number(etf.volumeTradedUSD) + depositAmountUSD).toFixed(2)
    etf.markModified("volumeTraded")
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
    const sharePrice = parseFloat(etf.sharePrice)
    const depositAmountUSD = sharePrice * Number(ethers.parseUnits(shares.toString(), etf.shareDecimals ?? 18).toString())
    const currentVolume = Number(walletHolding.volumeTraded?.toString() ?? "0")

    walletHolding.volumeTraded = (currentVolume - depositAmountUSD).toFixed(2)
    if (Number(walletHolding.volumeTraded) < 0) {
      walletHolding.volumeTraded = "0"
    }
    walletHolding.markModified("volumeTraded")
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
  // const currentVolume = BigInt(walletHolding.volumeTraded?.toString() ?? "0")
  walletHolding.transactionsPerformed = currentTransactions + 1
  // walletHolding.volumeTraded = currentVolume + volumeAmount
  walletHolding.markModified("transactionsPerformed")
  walletHolding.markModified("volumeTraded")
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
      volumeTraded: 0n,
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
  etf: InstanceType<typeof ETF> | null,
  vault: `0x${string}`,
  amount: bigint
): {
  chain: number
  symbol: string
  decimals: number
  etfVaultAddress: string
  etfTokenAddress: string
  amount: bigint
} {
  if (etf) {
    return {
      chain: Number(chainId),
      symbol: etf.symbol,
      decimals: etf.shareDecimals ?? 18,
      etfVaultAddress: etf.vault, // Always set vault address
      etfTokenAddress: etf.shareToken,
      amount: amount,
    }
  } else {
    return {
      chain: Number(chainId),
      symbol: vault, // Use vault address as symbol when ETF not found
      decimals: 18,
      etfVaultAddress: vault, // Always set vault address
      etfTokenAddress: vault, // Use vault as token address when ETF not found
      amount: amount,
    }
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
    const deposit = createDepositObject(chainId, etf, vault, sharesOut ?? 0n)
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
function getNoncesResearched(lastNonce: bigint, currentEventNonce: bigint): Set<bigint> {
  const noncesResearched = new Set<bigint>()
  for (let i = lastNonce + 1n; i <= currentEventNonce; i++) {
    noncesResearched.add(i)
  }
  return noncesResearched
}

/**
 * Get factory events from blockchain in order of most likely to be used
 * Stops early if all nonces have been found to optimize RPC calls
 */
async function getFactoryEvents(
  client: PublicClient,
  contractAddress: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  lastNonce: bigint,
  noncesResearched: Set<bigint>
): Promise<EventLog[]> {
  const newEvents: EventLog[] = []
  const noncesFound = new Set<bigint>()

  // 1. Deposit events (most frequent)
  const depositEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event Deposit(address indexed vault, address user, uint256 depositAmount, uint256 sharesOut, uint256 eventNonce, uint256 eventHeight)",
      ]),
    })
  ).filter((log: any) => (log.args.eventNonce ?? 0n) > lastNonce)

  for (const log of depositEvents) {
    newEvents.push(log as EventLog)
    const nonce = (log as any).args.eventNonce ?? 0n
    if (nonce > lastNonce && noncesResearched.has(nonce)) {
      noncesFound.add(nonce)
    }
  }

  if (noncesFound.size === noncesResearched.size) {
    // All nonces found - gain of 4 calls eth_logs to the ethereum rpc
    return newEvents
  }

  // 2. Redeem events
  const redeemEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event Redeem(address indexed vault, address user, uint256 sharesIn, uint256 depositOut, uint256 eventNonce, uint256 eventHeight)",
      ]),
    })
  ).filter((log: any) => (log.args.eventNonce ?? 0n) > lastNonce)

  for (const log of redeemEvents) {
    newEvents.push(log as EventLog)
    const nonce = (log as any).args.eventNonce ?? 0n
    if (nonce > lastNonce && noncesResearched.has(nonce)) {
      noncesFound.add(nonce)
    }
  }

  if (noncesFound.size === noncesResearched.size) {
    // All nonces found - gain of 3 calls eth_logs to the ethereum rpc
    return newEvents
  }

  // 3. ETFCreated events
  const etfCreatedEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event ETFCreated(address indexed vault, uint256 eventNonce, uint256 eventHeight, uint256 etfNonce, address shareToken, string name, string symbol)",
      ]),
    })
  ).filter((log: any) => (log.args.eventNonce ?? 0n) > lastNonce)

  for (const log of etfCreatedEvents) {
    newEvents.push(log as EventLog)
    const nonce = (log as any).args.eventNonce ?? 0n
    if (nonce > lastNonce && noncesResearched.has(nonce)) {
      noncesFound.add(nonce)
    }
  }

  if (noncesFound.size === noncesResearched.size) {
    // All nonces found - gain of 2 calls eth_logs to the ethereum rpc
    return newEvents
  }

  // 4. Rebalance events
  const rebalanceEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event Rebalance(address indexed vault, uint256 fromIndex, uint256 toIndex, uint256 moveValue, uint256 eventNonce, uint256 eventHeight, uint256 bought)",
      ]),
    })
  ).filter((log: any) => (log.args.eventNonce ?? 0n) > lastNonce)

  for (const log of rebalanceEvents) {
    newEvents.push(log as EventLog)
    const nonce = (log as any).args.eventNonce ?? 0n
    if (nonce > lastNonce && noncesResearched.has(nonce)) {
      noncesFound.add(nonce)
    }
  }

  if (noncesFound.size === noncesResearched.size) {
    // All nonces found - gain of 1 call eth_logs to the ethereum rpc
    return newEvents
  }

  // 5. ParamsUpdated events
  const paramsUpdatedEvents = (
    await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        "event ParamsUpdated(address indexed vault, uint256 imbalanceThresholdBps, uint256 maxPriceStaleness, uint256 eventNonce, uint256 eventHeight)",
      ]),
    })
  ).filter((log: any) => (log.args.eventNonce ?? 0n) > lastNonce)

  for (const log of paramsUpdatedEvents) {
    newEvents.push(log as EventLog)
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

    if (walletHolding.volumeTraded !== undefined) {
      updateOp.$set.volumeTraded = walletHolding.volumeTraded
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
      volumeTraded: doc.volumeTraded || 0n,
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
        $or: [
          { updatedAt: { $lt: oneMinuteAgo } },
          { updatedAt: { $exists: false } },
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
 * Observe and process lending events for a specific chain
 */
async function observeEvents(chainId: ChainId, client: PublicClient): Promise<void> {
  if (DEFAULT_START_BLOCKS[chainId] == 0n) return

  // Get or create observe progress for this chain
  let observeProgress = await ObserveEvents.findOne({ chain: Number(chainId) })
  
  // Get last event for nonce tracking
  const lastEventObserved = await Event.findOne({
    chain: Number(chainId),
  }).sort({ blockNumber: -1, nonce: -1 })

  // Determine starting block number
  let fromBlock: bigint
  if (observeProgress) {
    // Use saved progress (toBlock from last run becomes fromBlock)
    fromBlock = observeProgress.lastBlockNumber
    console.log("fromBlock", fromBlock)
  } else {
    // First time: use last event block or default start block
    fromBlock = lastEventObserved?.blockNumber ?? DEFAULT_START_BLOCKS[chainId]
    console.log("fromBlock", fromBlock)
    console.log("lastEventObserved", lastEventObserved)
    console.log("DEFAULT_START_BLOCKS[chainId]", DEFAULT_START_BLOCKS[chainId])
  }

  const lastEventObservedNonce = lastEventObserved?.nonce ?? 0n

  // Get latest block number to avoid going beyond the chain
  const latestBlock = await client.getBlockNumber()

  const latestEventNonce = await client.readContract({
    address: ETF_CONTRACT_ADDRS[chainId] as `0x${string}`,
    abi: parseAbi(["function state_lastEventNonce() view returns (uint256)"]),
    functionName: "state_lastEventNonce",
  })

  const latestEventHeight = await client.readContract({
    address: ETF_CONTRACT_ADDRS[chainId] as `0x${string}`,
    abi: parseAbi(["function state_lastEventHeight() view returns (uint256)"]),
    functionName: "state_lastEventHeight",
  })

  console.log("latestEventNonce", latestEventNonce)
  console.log("latestEventHeight", latestEventHeight)

  // Calculate toBlock but don't exceed latest block
  const calculatedToBlock = fromBlock + GET_LOGS_BLOCKS[chainId]
  const toBlock = calculatedToBlock > latestBlock ? latestBlock : calculatedToBlock

  // If we're already at the latest block, don't process
  if (fromBlock >= latestBlock) {
    console.log(
      `Chain ${chainId} already at latest block ${latestBlock}, fromBlock: ${fromBlock}`
    )
    return
  }

  if (latestEventNonce <= lastEventObservedNonce) {
    console.log("latestEventNonce <= lastEventObservedNonce", latestEventNonce, lastEventObservedNonce)
    console.log("No new events to process for chain", chainId, "range", fromBlock, toBlock)
    // Still save progress even if no new events, but don't exceed latest block
    const savedToBlock = toBlock >= latestBlock ? latestBlock : toBlock
    await ObserveEvents.findOneAndUpdate(
      { chain: Number(chainId) },
      {
        chain: Number(chainId),
        lastBlockNumber: savedToBlock,
        lastNonce: lastEventObservedNonce,
      },
      { upsert: true }
    )
    return
  }

  // Get all nonces between lastNonce and latestEventNonce to optimize RPC calls
  const noncesResearched = getNoncesResearched(lastEventObservedNonce, latestEventNonce)

  const contractAddress = ETF_CONTRACT_ADDRS[chainId] as `0x${string}`

  console.log("noncesResearched", noncesResearched)
  // Get events from blockchain
  const newEvents = await getFactoryEvents(
    client,
    contractAddress,
    fromBlock,
    toBlock,
    lastEventObservedNonce,
    noncesResearched
  )

  console.log("newEvents", newEvents, fromBlock, toBlock)

  // Sort events by eventNonce (or nonce) first, then by blockNumber to ensure correct order
  newEvents.sort((a, b) => {
    const nonceA = a.args.eventNonce ?? a.args.nonce ?? 0n
    const nonceB = b.args.eventNonce ?? b.args.nonce ?? 0n
    if (nonceA !== nonceB) {
      return nonceA < nonceB ? -1 : 1
    }
    // If nonces are equal, sort by blockNumber
    return a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0
  })

  if (newEvents.length === 0) {
    // Save progress even if no events found (to advance the block range)
    // But don't exceed latest block (reuse latestBlock from above)
    const savedToBlock = toBlock >= latestBlock ? latestBlock : toBlock
    await ObserveEvents.findOneAndUpdate(
      { chain: Number(chainId) },
      {
        chain: Number(chainId),
        lastBlockNumber: savedToBlock,
        lastNonce: lastEventObservedNonce,
      },
      { upsert: true }
    )
    console.log(
      `No events found for chain ${chainId}, advanced to block ${savedToBlock} (latest: ${latestBlock})`
    )
    return
  }

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
  // This ensures we don't lose progress if the program is interrupted
  await processEvents(newEvents, chainId, client, holdingsMap, existingWalletSet, latestBlock)
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
