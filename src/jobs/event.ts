import { CronJob } from "cron"
import WalletHolding from "../models/WalletHolding"
import { ChainId, GET_LOGS_BLOCKS, publicClients } from "../config/web3"
import Event from "../models/Event"
import ETF from "../models/ETF"
import ObserveEvents from "../models/ObserveEvents"
import { parseAbi, type PublicClient, encodeFunctionData, decodeFunctionResult, erc20Abi } from "viem"
import {
  ETF_CONTRACT_ADDRS,
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
    etfHeight?: bigint
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
        "event ETFCreated(address indexed vault, uint256 eventNonce, uint256 eventHeight, uint256 etfNonce, uint256 etfHeight, address shareToken, address depositToken, string name, string symbol)",
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
 * Fetch vault configuration from blockchain
 */
async function fetchVaultConfig(
  client: PublicClient,
  vaultAddress: `0x${string}`
): Promise<{
  factory: string
  depositToken: string
  depositFeed: string
  router: string
  shareToken: string
  assets: Array<{
    token: string
    feed: string
    targetWeightBps: number
    depositPath: string[]
    withdrawPath: string[]
    symbol?: string
    decimals?: number
  }>
  imbalanceThresholdBps: bigint
  maxPriceStaleness: bigint
  depositSymbol: string
  depositDecimals: number
  shareDecimals: number
}> {
  const vaultAbi = parseAbi([
    "function factory() view returns (address)",
    "function depositToken() view returns (address)",
    "function depositFeed() view returns (address)",
    "function router() view returns (address)",
    "function shareToken() view returns (address)",
    "function assetCount() view returns (uint256)",
    "function imbalanceThresholdBps() view returns (uint256)",
    "function maxPriceStaleness() view returns (uint256)",
  ])

  const [factory, depositToken, depositFeed, router, shareToken, assetsLength, imbalanceThresholdBps, maxPriceStaleness] =
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
        functionName: "router",
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
      client.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "maxPriceStaleness",
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
            { name: "feed", type: "address" },
            { name: "targetWeightBps", type: "uint256" },
            { name: "depositPath", type: "address[]" },
            { name: "withdrawPath", type: "address[]" },
          ] }
        ],
        stateMutability: "view",
      }
    ],
    data: raw.data,
  })
  
  const assets = assetsResults.map((asset: any) => ({
    token: asset.token as string,
    feed: asset.feed as string,
    targetWeightBps: Number(asset.targetWeightBps),
    depositPath: asset.depositPath as string[],
    withdrawPath: asset.withdrawPath as string[],
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
    router: router as string,
    shareToken: shareToken as string,
    assets: assetsWithDetails,
    imbalanceThresholdBps: imbalanceThresholdBps as bigint,
    maxPriceStaleness: maxPriceStaleness as bigint,
    depositSymbol,
    depositDecimals,
    shareDecimals,
  }
}

/**
 * Process events and update wallet holdings in memory
 */
async function processEvents(
  events: EventLog[],
  chainId: ChainId,
  client: PublicClient,
  holdingsMap: Map<string, InstanceType<typeof WalletHolding>>,
  etfsMap: Map<string, InstanceType<typeof ETF>>
): Promise<void> {
  for (const log of events) {
    if (log.eventName === "Deposit") {
      const { vault, user, depositAmount, sharesOut } = log.args

      if (!vault || !user) continue

      let walletHolding = holdingsMap.get(user)
      if (!walletHolding) {
        walletHolding = new WalletHolding({
          wallet: user,
          deposits: [],
          borrows: [],
          rewards: [],
          transactionsPerformed: 0,
          volumeTraded: 0n,
        })
        holdingsMap.set(user, walletHolding)
      }

      // Store deposit using vault address as symbol
      const depositIndex = walletHolding.deposits.findIndex(
        (deposit) =>
          deposit.chain === Number(chainId) &&
          deposit.symbol === vault
      )
      if (depositIndex !== -1) {
        const currentAmount = BigInt(walletHolding.deposits[depositIndex].amount?.toString() ?? "0")
        walletHolding.deposits[depositIndex].amount = currentAmount + (sharesOut ?? 0n)
        walletHolding.markModified("deposits")
      } else {
        walletHolding.deposits.push({
          chain: Number(chainId),
          symbol: vault,
          amount: sharesOut ?? 0n,
        })
        walletHolding.markModified("deposits")
      }

      // Update transactions and volume
      const currentTransactions = walletHolding.transactionsPerformed ?? 0
      const currentVolume = BigInt(walletHolding.volumeTraded?.toString() ?? "0")
      walletHolding.transactionsPerformed = currentTransactions + 1
      const depositAmountBigInt = depositAmount ? BigInt(depositAmount.toString()) : 0n
      walletHolding.volumeTraded = currentVolume + depositAmountBigInt
      walletHolding.markModified("transactionsPerformed")
      walletHolding.markModified("volumeTraded")

      console.log("Deposit:", user, vault, depositAmount, sharesOut)
    } else if (log.eventName === "Redeem") {
      const { vault, user, sharesIn, depositOut } = log.args

      if (!vault || !user) continue

      const vaultLower = vault.toLowerCase()

      let walletHolding = holdingsMap.get(user)
      if (!walletHolding) {
        walletHolding = new WalletHolding({
          wallet: user,
          deposits: [],
          borrows: [],
          rewards: [],
          transactionsPerformed: 0,
          volumeTraded: 0n,
        })
        holdingsMap.set(user, walletHolding)
      }

      // Remove shares from deposit using vault address as symbol
      const depositIndex = walletHolding.deposits.findIndex(
        (deposit) =>
          deposit.chain === Number(chainId) &&
          deposit.symbol.toLowerCase() === vaultLower
      )
      if (depositIndex !== -1) {
        const currentAmount = BigInt(walletHolding.deposits[depositIndex].amount?.toString() ?? "0")
        walletHolding.deposits[depositIndex].amount = currentAmount - (sharesIn ?? 0n)
        walletHolding.markModified("deposits")
      } else {
        walletHolding.deposits.push({
          chain: Number(chainId),
          symbol: vault,
          amount: 0n - (sharesIn ?? 0n),
        })
        walletHolding.markModified("deposits")
      }

      // Update transactions and volume
      const currentTransactions = walletHolding.transactionsPerformed ?? 0
      const currentVolume = BigInt(walletHolding.volumeTraded?.toString() ?? "0")
      walletHolding.transactionsPerformed = currentTransactions + 1
      const depositOutBigInt = depositOut ? BigInt(depositOut.toString()) : 0n
      walletHolding.volumeTraded = currentVolume + depositOutBigInt
      walletHolding.markModified("transactionsPerformed")
      walletHolding.markModified("volumeTraded")

      console.log("Redeem:", user, vault, sharesIn, depositOut)
    } else if (log.eventName === "ETFCreated") {
      const {
        vault,
        eventNonce,
        eventHeight,
        etfNonce,
        etfHeight,
        shareToken,
        depositToken,
        name,
        symbol,
      } = log.args

      if (!vault) continue

      const vaultLower = vault.toLowerCase()

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
          etfHeight: etfHeight ?? 0n,
          factory: vaultConfig.factory,
          depositFeed: vaultConfig.depositFeed,
          router: vaultConfig.router,
          assets: vaultConfig.assets,
          imbalanceThresholdBps: vaultConfig.imbalanceThresholdBps,
          maxPriceStaleness: vaultConfig.maxPriceStaleness,
          depositSymbol: vaultConfig.depositSymbol,
          depositDecimals: vaultConfig.depositDecimals,
          shareDecimals: vaultConfig.shareDecimals,
        })

        etfsMap.set(vaultLower, etf)
        console.log("ETF created:", vault, name, symbol)
      } catch (error) {
        console.error(`Error fetching vault config for ${vault}:`, error)
        // Still create ETF entry with basic info from event
        const etf = new ETF({
          vault: vault,
          chain: Number(chainId),
          shareToken: shareToken ?? "",
          depositToken: depositToken ?? "",
          name: name ?? "",
          symbol: symbol ?? "",
          tvl: "0",
          eventNonce: eventNonce ?? 0n,
          eventHeight: eventHeight ?? 0n,
          etfNonce: etfNonce ?? 0n,
          etfHeight: etfHeight ?? 0n,
        })
        etfsMap.set(vaultLower, etf)
      }
    } else if (log.eventName === "Rebalance") {
      const { vault } = log.args

      if (!vault) continue

      // TODO: save liquidity tvl on the etf
    } else if (log.eventName === "ParamsUpdated") {
      const { vault } = log.args

      if (!vault) continue

      // TODO: handle params update
    }
  }
}

/**
 * Convert BigInt to string with decimals rounding
 */
function formatTokenAmount(amount: bigint | undefined, decimals: number): string | undefined {
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
function formatUSDValue(value: bigint): string {
  return formatTokenAmount(value, 18) ?? "0"
}

/**
 * Fetch portfolio value and NAV from vault contract
 */
async function fetchVaultPortfolio(
  client: PublicClient,
  vaultAddress: `0x${string}`
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

  return {
    totalValue: formatUSDValue(totalValue),
    valuesPerAsset: valuesPerAsset.map((value) => formatUSDValue(value)),
    nav: formatUSDValue(nav),
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

  // Find ETFs that need updating (not updated in the last minute)
  const etfsToUpdate = await ETF.find({
    vault: { $in: Array.from(vaultAddresses) },
    $or: [
      { updatedAt: { $lt: oneMinuteAgo } },
      { updatedAt: { $exists: false } },
    ],
  })

  if (etfsToUpdate.length === 0) {
    console.log("No ETFs to update")
    return
  }

  // Update each ETF
  const updatePromises = etfsToUpdate.map(async (etf) => {
    try {
      const portfolio = await fetchVaultPortfolio(
        client,
        etf.vault as `0x${string}`
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
      console.error(`Error updating portfolio for ETF ${etf.vault}:`, error)
    }
  })

  await Promise.all(updatePromises)
}

/**
 * Save events and wallet holdings to database
 */
async function saveEventsAndHoldings(
  events: EventLog[],
  chainId: ChainId,
  holdingsMap: Map<string, InstanceType<typeof WalletHolding>>,
  existingWalletSet: Set<string>,
  etfsMap: Map<string, InstanceType<typeof ETF>>
): Promise<void> {
  // Build bulk operations for wallet holdings
  const bulkOps: any[] = []
  for (const [wallet, walletHolding] of holdingsMap.entries()) {
    if (existingWalletSet.has(wallet)) {
      // Update existing - ensure deposits and borrows have valid amount values
      const deposits = (walletHolding.deposits || []).map((deposit: any) => ({
        chain: deposit.chain,
        symbol: deposit.symbol,
        amount: deposit.amount ?? 0n,
      }))
      
      const borrows = (walletHolding.borrows || []).map((borrow: any) => ({
        chain: borrow.chain,
        symbol: borrow.symbol,
        amount: borrow.amount ?? 0n,
      }))
      
      const updateOp: any = {
        $set: {
          deposits,
          borrows,
        },
      }

      // Update transactionsPerformed and volumeTraded if they exist
      if (walletHolding.transactionsPerformed !== undefined) {
        updateOp.$set.transactionsPerformed = walletHolding.transactionsPerformed
      }

      if (walletHolding.volumeTraded !== undefined) {
        updateOp.$set.volumeTraded = walletHolding.volumeTraded
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: walletHolding._id },
          update: updateOp,
        },
      })
    } else {
      // Insert new - convert Mongoose document to plain object
      const doc = walletHolding.toObject
        ? walletHolding.toObject()
        : walletHolding
      
      // Ensure deposits and borrows have valid amount values
      const deposits = (doc.deposits || []).map((deposit: any) => ({
        chain: deposit.chain,
        symbol: deposit.symbol,
        amount: deposit.amount ?? 0n,
      }))
      
      const borrows = (doc.borrows || []).map((borrow: any) => ({
        chain: borrow.chain,
        symbol: borrow.symbol,
        amount: borrow.amount ?? 0n,
      }))
      
      bulkOps.push({
        insertOne: {
          document: {
            wallet: doc.wallet,
            deposits,
            borrows,
            rewards: [],
            tvl: "0",
            apy: 0,
            transactionsPerformed: doc.transactionsPerformed || 0,
            volumeTraded: doc.volumeTraded || 0n,
          },
        },
      })
    }
  }

  // Execute bulk write
  if (bulkOps.length > 0) {
    await WalletHolding.bulkWrite(bulkOps)
  }

  // Build bulk operations for ETFs
  const etfBulkOps: any[] = []
  const existingVaults = await ETF.find({
    vault: { $in: Array.from(etfsMap.keys()) },
  })
  const existingVaultSet = new Set<string>()
  for (const etf of existingVaults) {
    existingVaultSet.add(etf.vault.toLowerCase())
  }

  for (const [vaultLower, etf] of etfsMap.entries()) {
    if (existingVaultSet.has(vaultLower)) {
      // Update existing ETF
      const existingEtf = existingVaults.find(
        (e) => e.vault.toLowerCase() === vaultLower
      )
      if (existingEtf) {
        const doc = etf.toObject ? etf.toObject() : etf
        etfBulkOps.push({
          updateOne: {
            filter: { _id: existingEtf._id },
            update: {
              $set: {
                shareToken: doc.shareToken,
                depositToken: doc.depositToken,
                name: doc.name,
                symbol: doc.symbol,
                eventNonce: doc.eventNonce,
                eventHeight: doc.eventHeight,
                etfNonce: doc.etfNonce,
                etfHeight: doc.etfHeight,
                factory: doc.factory,
                depositFeed: doc.depositFeed,
                router: doc.router,
                assets: doc.assets || [],
                imbalanceThresholdBps: doc.imbalanceThresholdBps,
                maxPriceStaleness: doc.maxPriceStaleness,
                depositSymbol: doc.depositSymbol,
                depositDecimals: doc.depositDecimals,
                shareDecimals: doc.shareDecimals,
              },
            },
          },
        })
      }
    } else {
      // Insert new ETF
      const doc = etf.toObject ? etf.toObject() : etf
      etfBulkOps.push({
        insertOne: {
          document: {
            vault: doc.vault,
            chain: doc.chain,
            shareToken: doc.shareToken,
            depositToken: doc.depositToken,
            name: doc.name,
            symbol: doc.symbol,
            tvl: doc.tvl || "0",
            eventNonce: doc.eventNonce,
            eventHeight: doc.eventHeight,
            etfNonce: doc.etfNonce,
            etfHeight: doc.etfHeight,
            factory: doc.factory,
            depositFeed: doc.depositFeed,
            router: doc.router,
            assets: doc.assets || [],
            imbalanceThresholdBps: doc.imbalanceThresholdBps,
            maxPriceStaleness: doc.maxPriceStaleness,
            depositSymbol: doc.depositSymbol,
            depositDecimals: doc.depositDecimals,
            shareDecimals: doc.shareDecimals,
          },
        },
      })
    }
  }

  // Execute bulk write for ETFs
  if (etfBulkOps.length > 0) {
    await ETF.bulkWrite(etfBulkOps)
  }

  // Get all vault addresses from events to fetch ETF decimals
  const vaultAddresses = new Set<string>()
  for (const log of events) {
    if (log.args.vault) {
      vaultAddresses.add(log.args.vault.toLowerCase())
    }
  }

  // Fetch ETFs to get decimals for formatting (already stored from ETFCreated events)
  const etfs = await ETF.find({
    vault: { $in: Array.from(vaultAddresses) },
  })
  const etfMap = new Map<string, InstanceType<typeof ETF>>()
  for (const etf of etfs) {
    etfMap.set(etf.vault.toLowerCase(), etf)
  }

  // Save events
  await Event.insertMany(
    events.map((log) => {
      const vaultLower = log.args.vault?.toLowerCase()
      const etf = vaultLower ? etfMap.get(vaultLower) : undefined
      const depositDecimals = etf?.depositDecimals ?? 18
      const shareTokenDecimals = etf?.shareDecimals ?? 18

      return {
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
        etfHeight: log.args.etfHeight?.toString(),
        shareToken: log.args.shareToken ?? undefined,
        depositToken: log.args.depositToken ?? undefined,
        name: log.args.name ?? undefined,
        symbol: log.args.symbol ?? undefined,
      }
    })
  )
}

/**
 * Observe and process lending events for a specific chain
 */
async function observeEvents(chainId: ChainId, client: PublicClient): Promise<void> {
  if (DEFAULT_START_BLOCKS[chainId] == 0n) return

  // Get or create observe progress for this chain
  let observeProgress = await ObserveEvents.findOne({ chain: Number(chainId) })
  
  // Get last event for nonce tracking
  const lastEvent = await Event.findOne({
    chain: Number(chainId),
  }).sort({ blockNumber: -1, nonce: -1 })

  // Determine starting block number
  let fromBlock: bigint
  if (observeProgress) {
    // Use saved progress (toBlock from last run becomes fromBlock)
    fromBlock = observeProgress.lastBlockNumber
  } else {
    // First time: use last event block or default start block
    fromBlock = lastEvent?.blockNumber ?? DEFAULT_START_BLOCKS[chainId]
  }

  const lastNonce = lastEvent?.nonce ?? 0n

  // Get latest block number to avoid going beyond the chain
  const latestBlock = await client.getBlockNumber()

  const currentEventNonce = await client.readContract({
    address: ETF_CONTRACT_ADDRS[chainId] as `0x${string}`,
    abi: parseAbi(["function state_lastEventNonce() view returns (uint256)"]),
    functionName: "state_lastEventNonce",
  })

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

  if (currentEventNonce <= lastNonce) {
    console.log("No new events to process for chain", chainId, "range", fromBlock, toBlock)
    // Still save progress even if no new events, but don't exceed latest block
    const savedToBlock = toBlock >= latestBlock ? latestBlock : toBlock
    await ObserveEvents.findOneAndUpdate(
      { chain: Number(chainId) },
      {
        chain: Number(chainId),
        lastBlockNumber: savedToBlock,
        lastNonce: lastNonce,
      },
      { upsert: true }
    )
    return
  }

  // Get all nonces between lastNonce and currentEventNonce to optimize RPC calls
  const noncesResearched = getNoncesResearched(lastNonce, currentEventNonce)

  const contractAddress = ETF_CONTRACT_ADDRS[chainId] as `0x${string}`

  // Get events from blockchain
  const newEvents = await getFactoryEvents(
    client,
    contractAddress,
    fromBlock,
    toBlock,
    lastNonce,
    noncesResearched
  )

  if (newEvents.length === 0) {
    // Save progress even if no events found (to advance the block range)
    // But don't exceed latest block (reuse latestBlock from above)
    const savedToBlock = toBlock >= latestBlock ? latestBlock : toBlock
    await ObserveEvents.findOneAndUpdate(
      { chain: Number(chainId) },
      {
        chain: Number(chainId),
        lastBlockNumber: savedToBlock,
        lastNonce: lastNonce,
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

  // Create map for ETFs
  const etfsMap = new Map<string, InstanceType<typeof ETF>>()

  // Process all events and update in-memory objects
  await processEvents(newEvents, chainId, client, holdingsMap, etfsMap)

  // Save events and holdings to database
  await saveEventsAndHoldings(
    newEvents,
    chainId,
    holdingsMap,
    existingWalletSet,
    etfsMap
  )

  // Collect vault addresses from events for portfolio update
  const vaultAddressesForUpdate = new Set<string>()
  for (const log of newEvents) {
    if (log.args.vault) {
      vaultAddressesForUpdate.add(log.args.vault)
    }
  }

  // Update ETF portfolio values if needed
  await updateETFPortfolio(chainId, client, vaultAddressesForUpdate)

  // Update progress with final nonce from processed events
  const finalNonce = newEvents.reduce((max, event) => {
    const eventNonce = event.args.eventNonce ?? event.args.nonce ?? 0n
    return eventNonce > max ? eventNonce : max
  }, lastNonce)

  // Ensure we don't exceed latest block (reuse latestBlock from above)
  const savedToBlock = toBlock >= latestBlock ? latestBlock : toBlock

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
