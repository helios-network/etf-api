import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MasterOnly } from '../../common/decorators/master-only.decorator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { parseAbi, type PublicClient } from 'viem';
import { ChainId } from '../../config/web3';
import {
  ETF_CONTRACT_ADDRS,
  DEFAULT_START_BLOCKS,
} from '../../constants';
import { Web3Service } from '../../services/web3.service';
import { VaultUtilsService } from '../../services/vault-utils.service';
import { WalletHoldingUtilsService } from '../../services/wallet-holding-utils.service';
import { Event, EventDocument } from '../../models/event.schema';
import {
  ObserveEvents,
  ObserveEventsDocument,
} from '../../models/observe-events.schema';
import { ETF, ETFDocument } from '../../models/etf.schema';
import {
  WalletHolding,
  WalletHoldingDocument,
} from '../../models/wallet-holding.schema';
import { normalizeEthAddress } from '../../common/utils/eip55';

// Constants following the Go code pattern
const ETH_BLOCK_CONFIRMATION_DELAY = 4n; // Minimum number of confirmations for a block to be considered valid
const DEFAULT_BLOCKS_TO_SEARCH = 2000n; // Maximum block range for event query

// Average block time in milliseconds (Ethereum mainnet ~12s, Arbitrum ~0.25s)
const AVERAGE_BLOCK_TIME_MS: Record<ChainId, bigint> = {
  [ChainId.MAINNET]: 12000n, // 12 seconds
  [ChainId.ARBITRUM]: 250n, // 0.25 seconds
};

type EventLog = {
  eventName: string;
  args: {
    user?: string;
    token?: `0x${string}`;
    amount?: bigint;
    nonce?: bigint;
    eventNonce?: bigint;
    eventHeight?: bigint;
    vault?: `0x${string}`;
    depositAmount?: bigint;
    sharesOut?: bigint;
    sharesIn?: bigint;
    depositOut?: bigint;
    amountsOut?: bigint[];
    valuesPerAsset?: bigint[];
    soldAmounts?: bigint[];
    fromIndex?: bigint;
    toIndex?: bigint;
    moveValue?: bigint;
    bought?: bigint;
    imbalanceThresholdBps?: bigint;
    maxPriceStaleness?: bigint;
    hlsBalance?: bigint;
    etfNonce?: bigint;
    shareToken?: `0x${string}`;
    depositToken?: `0x${string}`;
    name?: string;
    symbol?: string;
  };
  blockNumber: bigint;
  transactionHash?: `0x${string}`;
};

interface WalletHoldingData {
  wallet: string;
  deposits: Array<{
    chain: number;
    symbol: string;
    decimals: number;
    etfVaultAddress: string;
    etfTokenAddress: string;
    amount: string; // BigInt as string
    amountUSD: number;
  }>;
  rewards: any[];
  createEtfCount: number;
  depositCount: number;
  redeemCount: number;
  rebalanceCount: number;
  volumeTradedUSD: number;
  tvl: number;
  _id?: any;
}

@Injectable()
@MasterOnly()
export class EventProcessingJob {
  private readonly logger = new Logger(EventProcessingJob.name);
  // Track missed events block height per chain
  private missedEventsBlockHeight: Map<ChainId, bigint> = new Map();
  // Mutex to prevent concurrent execution of the cron job
  private isRunning = false;
  private startup = false;

  constructor(
    @InjectModel(Event.name)
    private eventModel: Model<EventDocument>,
    @InjectModel(ObserveEvents.name)
    private observeEventsModel: Model<ObserveEventsDocument>,
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
    @InjectModel(WalletHolding.name)
    private walletHoldingModel: Model<WalletHoldingDocument>,
    private readonly web3Service: Web3Service,
    private readonly vaultUtils: VaultUtilsService,
    private readonly walletHoldingUtils: WalletHoldingUtilsService,
  ) {
    this.logger.log('EventProcessingJob constructor called');
  }

  /**
   * Middleware to update wallet TVL after deposit/redeem operations
   */
  private async middlewareAfterDeposit(
    shares: bigint,
    walletHolding: WalletHoldingData,
    etf: ETFDocument,
    client: PublicClient,
  ): Promise<void> {
    // Update ETF TVL and share price
    await this.updateETFPortfolio(etf.chain, client, new Set([etf.vault]));

    // Update wallet TVL
    const calculatedTVL = await this.walletHoldingUtils.calculateWalletTVL(
      walletHolding.deposits,
    );
    walletHolding.tvl = calculatedTVL;

    if (etf.sharePrice != undefined) {
      const shareDecimals = etf.shareDecimals ?? 18;
      // Convert shares (bigint in base units) to human-readable for volume calculation
      // Old code: Number(ethers.parseUnits(shares.toString(), shareDecimals).toString())
      // Since shares is already in base units, we convert to decimal for price calculation
      const sharesInHumanReadable = Number(shares) / Math.pow(10, shareDecimals);
      const depositAmountUSD = etf.sharePrice * sharesInHumanReadable;
      const currentVolume = walletHolding.volumeTradedUSD;

      walletHolding.volumeTradedUSD = Number(
        (currentVolume + depositAmountUSD).toFixed(2),
      );
      if (walletHolding.volumeTradedUSD < 0) {
        walletHolding.volumeTradedUSD = 0;
      }

      // Update ETF volume traded USD
      etf.volumeTradedUSD = (etf.volumeTradedUSD ?? 0) + depositAmountUSD;
    }

    // Update ETF total supply
    // totalSupply is stored as number (base units)
    // shares is already in base units, so we use it directly
    await this.etfModel.updateOne(
      { _id: etf._id },
      {
        $set: { volumeTradedUSD: etf.volumeTradedUSD },
        $inc: { totalSupply: Number(shares) },
      },
    );
  }

  private async middlewareAfterRedeem(
    shares: bigint,
    walletHolding: WalletHoldingData,
    etf: ETFDocument,
    client: PublicClient,
  ): Promise<void> {
    // Update ETF TVL and share price
    await this.updateETFPortfolio(etf.chain, client, new Set([etf.vault]));

    // Update wallet TVL
    const calculatedTVL = await this.walletHoldingUtils.calculateWalletTVL(
      walletHolding.deposits,
    );
    walletHolding.tvl = calculatedTVL;

    if (etf.sharePrice != undefined) {
      const shareDecimals = etf.shareDecimals ?? 18;
      // Convert shares (bigint in base units) to human-readable for volume calculation
      // Old code: Number(ethers.parseUnits(shares.toString(), shareDecimals).toString())
      // Since shares is already in base units, we convert to decimal for price calculation
      const sharesInHumanReadable = Number(shares) / Math.pow(10, shareDecimals);
      const depositAmountUSD = etf.sharePrice * sharesInHumanReadable;
      const currentVolume = walletHolding.volumeTradedUSD;

      walletHolding.volumeTradedUSD = Number(
        (currentVolume + depositAmountUSD).toFixed(2),
      );
      if (walletHolding.volumeTradedUSD < 0) {
        walletHolding.volumeTradedUSD = 0;
      }

      // Update ETF volume traded USD
      etf.volumeTradedUSD = (etf.volumeTradedUSD ?? 0) + depositAmountUSD;
    }

    // Update ETF total supply
    // totalSupply is stored as number (base units)
    // shares is already in base units, so we use it directly
    const newTotalSupply = Math.max(0, (etf.totalSupply ?? 0) - Number(shares));
    await this.etfModel.updateOne(
      { _id: etf._id },
      {
        $set: { totalSupply: newTotalSupply, volumeTradedUSD: etf.volumeTradedUSD },
      },
    );
  }

  /**
   * Get or create wallet holding from map
   */
  private getOrCreateWalletHolding(
    user: string,
    holdingsMap: Map<string, WalletHoldingData>,
  ): WalletHoldingData {
    const normalizedWallet = normalizeEthAddress(user);
    let walletHolding = holdingsMap.get(normalizedWallet);
    if (!walletHolding) {
      walletHolding = {
        wallet: normalizedWallet,
        deposits: [],
        rewards: [],
        createEtfCount: 0,
        depositCount: 0,
        redeemCount: 0,
        rebalanceCount: 0,
        volumeTradedUSD: 0,
        tvl: 0,
      };
      holdingsMap.set(normalizedWallet, walletHolding);
    }
    return walletHolding;
  }

  /**
   * Find deposit index by chain and vault
   */
  private findDepositIndex(
    deposits: Array<{
      chain: number;
      etfVaultAddress?: string;
      symbol?: string;
    }>,
    chainId: ChainId,
    vault: string,
  ): number {
    const normalizedVault = normalizeEthAddress(vault);
    return deposits.findIndex(
      (deposit) =>
        deposit.chain === Number(chainId) &&
        (deposit.etfVaultAddress === normalizedVault ||
          (!deposit.etfVaultAddress && deposit.symbol === vault)),
    );
  }

  /**
   * Create deposit object with ETF metadata
   */
  private createDepositObject(
    chainId: ChainId,
    etf: ETFDocument,
    vault: `0x${string}`,
    amount: bigint,
  ): {
    chain: number;
    symbol: string;
    decimals: number;
    etfVaultAddress: string;
    etfTokenAddress: string;
    amount: string;
    amountUSD: number;
  } {
    const shareDecimals = etf.shareDecimals ?? 18;
    const sharesInHumanReadable = Number(amount) / Math.pow(10, shareDecimals);
    return {
      chain: Number(chainId),
      symbol: etf.symbol,
      decimals: shareDecimals,
      etfVaultAddress: normalizeEthAddress(etf.vault),
      etfTokenAddress: normalizeEthAddress(etf.shareToken),
      amount: amount.toString(),
      amountUSD: etf.sharePrice
        ? etf.sharePrice * sharesInHumanReadable
        : 0,
    };
  }

  /**
   * Process Deposit event
   */
  private async processDepositEvent(
    log: EventLog,
    chainId: ChainId,
    client: PublicClient,
    holdingsMap: Map<string, WalletHoldingData>,
  ): Promise<void> {
    const { vault, user, sharesOut } = log.args;

    if (!vault || !user || !sharesOut) return;

    const normalizedVault = normalizeEthAddress(vault);
    const normalizedUser = normalizeEthAddress(user);

    // Get or create wallet holding
    const walletHolding = this.getOrCreateWalletHolding(normalizedUser, holdingsMap);

    // Get ETF from database
    const etf = await this.etfModel.findOne({ vault: normalizedVault });

    if (!etf) {
      this.logger.warn(`ETF not found for vault ${vault}`);
      return;
    }

    // Find existing deposit
    const depositIndex = this.findDepositIndex(
      walletHolding.deposits,
      chainId,
      vault,
    );

    if (depositIndex !== -1) {
      // Update existing deposit
      const currentAmount = BigInt(
        walletHolding.deposits[depositIndex].amount?.toString() ?? '0',
      );
      walletHolding.deposits[depositIndex].amount = (
        currentAmount + sharesOut
      ).toString();

      // Always update metadata if ETF is available (to fix old deposits with wrong symbol)
      walletHolding.deposits[depositIndex].symbol = etf.symbol;
      walletHolding.deposits[depositIndex].decimals = etf.shareDecimals ?? 18;
      walletHolding.deposits[depositIndex].etfVaultAddress = normalizeEthAddress(etf.vault);
      walletHolding.deposits[depositIndex].etfTokenAddress = normalizeEthAddress(etf.shareToken);
    } else {
      // Create new deposit
      const deposit = this.createDepositObject(chainId, etf, vault, sharesOut);
      walletHolding.deposits.push(deposit);
    }

    // Increment deposit count
    walletHolding.depositCount = (walletHolding.depositCount ?? 0) + 1;
    
    // Increment ETF deposit count
    await this.etfModel.updateOne(
      { _id: etf._id },
      { $inc: { depositCount: 1 } },
    );
    
    // Apply middlewares
    await this.middlewareAfterDeposit(sharesOut, walletHolding, etf, client);
  }

  /**
   * Process Redeem event
   */
  private async processRedeemEvent(
    log: EventLog,
    chainId: ChainId,
    client: PublicClient,
    holdingsMap: Map<string, WalletHoldingData>,
  ): Promise<void> {
    const { vault, user, sharesIn } = log.args;

    if (!vault || !user || !sharesIn) return;

    const normalizedVault = normalizeEthAddress(vault);
    const normalizedUser = normalizeEthAddress(user);

    // Get or create wallet holding
    const walletHolding = this.getOrCreateWalletHolding(normalizedUser, holdingsMap);

    // Get ETF from database
    const etf = await this.etfModel.findOne({ vault: normalizedVault });

    if (!etf) {
      this.logger.warn(`ETF not found for vault ${vault}`);
      return;
    }

    // Find existing deposit
    const depositIndex = this.findDepositIndex(
      walletHolding.deposits,
      chainId,
      vault,
    );

    if (depositIndex !== -1) {
      // Update existing deposit
      const currentAmount = BigInt(
        walletHolding.deposits[depositIndex].amount?.toString() ?? '0',
      );
      walletHolding.deposits[depositIndex].amount = (
        currentAmount - sharesIn
      ).toString();

      // Always update metadata if ETF is available (to fix old deposits with wrong symbol)
      walletHolding.deposits[depositIndex].symbol = etf.symbol;
      walletHolding.deposits[depositIndex].decimals = etf.shareDecimals ?? 18;
      walletHolding.deposits[depositIndex].etfVaultAddress = etf.vault;
      walletHolding.deposits[depositIndex].etfTokenAddress = etf.shareToken;
    } else {
      // Create new deposit (negative amount for redeem)
      const deposit = this.createDepositObject(
        chainId,
        etf,
        vault,
        0n - sharesIn,
      );
      walletHolding.deposits.push(deposit);
    }

    // Increment redeem count
    walletHolding.redeemCount = (walletHolding.redeemCount ?? 0) + 1;
    
    // Increment ETF redeem count
    await this.etfModel.updateOne(
      { _id: etf._id },
      { $inc: { redeemCount: 1 } },
    );
    
    // Apply middlewares
    await this.middlewareAfterRedeem(sharesIn, walletHolding, etf, client);
  }

  /**
   * Process ETFCreated event
   */
  private async processETFCreatedEvent(
    log: EventLog,
    chainId: ChainId,
    client: PublicClient,
    holdingsMap: Map<string, WalletHoldingData>,
  ): Promise<void> {
    const {
      vault,
      eventNonce,
      eventHeight,
      etfNonce,
      shareToken,
      name,
      symbol,
    } = log.args;

    if (!vault) return;

    const normalizedVault = normalizeEthAddress(vault);

    // Try to get the creator wallet from transaction
    if (log.transactionHash) {
      try {
        const tx = await client.getTransaction({ hash: log.transactionHash });
        if (tx.from) {
          const walletHolding = this.getOrCreateWalletHolding(
            tx.from,
            holdingsMap,
          );
          walletHolding.createEtfCount = (walletHolding.createEtfCount ?? 0) + 1;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to get transaction for ETFCreated event: ${error}`,
        );
      }
    }

    try {
      // Fetch vault configuration from blockchain
      const vaultConfig = await this.vaultUtils.fetchVaultConfig(
        client,
        vault,
      );

      // Create new ETF entry with vault configuration
      await this.etfModel.create({
        vault: normalizedVault,
        owner: vaultConfig.owner,
        pricer: vaultConfig.pricer,
        pricingMode: vaultConfig.pricingMode,
        chain: Number(chainId),
        shareToken: vaultConfig.shareToken,
        depositToken: vaultConfig.depositToken,
        name: name ?? '',
        symbol: symbol ?? '',
        tvl: 0,
        totalSupply: 0,
        eventNonce: (eventNonce ?? 0n).toString(),
        eventHeight: (eventHeight ?? 0n).toString(),
        etfNonce: (etfNonce ?? 0n).toString(),
        factory: vaultConfig.factory,
        depositFeed: vaultConfig.depositFeed,
        assets: vaultConfig.assets,
        imbalanceThresholdBps: vaultConfig.imbalanceThresholdBps.toString(),
        depositSymbol: vaultConfig.depositSymbol,
        depositDecimals: vaultConfig.depositDecimals,
        shareDecimals: vaultConfig.shareDecimals,
      });

      this.logger.log(`ETF created: ${normalizedVault} (${name}/${symbol})`);
    } catch (error) {
      this.logger.error(`Error fetching vault config for ${normalizedVault}:`, error);
      // Still create ETF entry with basic info from event
      await this.etfModel.create({
        vault: normalizedVault,
        chain: Number(chainId),
        shareToken: shareToken ?? '',
        depositToken: '',
        name: name ?? '',
        symbol: symbol ?? '',
        tvl: 0,
        totalSupply: 0,
        eventNonce: (eventNonce ?? 0n).toString(),
        eventHeight: (eventHeight ?? 0n).toString(),
        etfNonce: (etfNonce ?? 0n).toString(),
      });
    }
  }

  /**
   * Process Rebalance event
   */
  private async processRebalanceEvent(
    log: EventLog,
    chainId: ChainId,
    client: PublicClient,
    holdingsMap: Map<string, WalletHoldingData>,
  ): Promise<void> {
    const { vault } = log.args;

    if (!vault) return;

    const normalizedVault = normalizeEthAddress(vault);

    // Find all wallets that have deposits in this vault
    try {
      const walletHoldings = await this.walletHoldingModel
        .find({
          'deposits.etfVaultAddress': normalizedVault,
          'deposits.chain': Number(chainId),
        })
        .lean()
        .exec();

      // Increment rebalanceCount for each wallet that has deposits in this vault
      for (const holding of walletHoldings) {
        const walletHolding = this.getOrCreateWalletHolding(
          holding.wallet,
          holdingsMap,
        );
        walletHolding.rebalanceCount =
          (walletHolding.rebalanceCount ?? 0) + 1;
      }
    } catch (error) {
      this.logger.error(
        `Error finding wallets for rebalance event in vault ${normalizedVault}:`,
        error,
      );
    }

    // TODO: save liquidity tvl on the etf
  }

  /**
   * Process ParamsUpdated event
   */
  private async processParamsUpdatedEvent(
    log: EventLog,
    chainId: ChainId,
    client: PublicClient,
  ): Promise<void> {
    const { vault } = log.args;

    if (!vault) return;

    // TODO: handle params update
  }

  /**
   * Get all nonces between lastNonce and currentEventNonce to optimize RPC calls
   */
  private getNoncesResearched(
    lastNonce: bigint,
    currentEventNonce: bigint,
  ): bigint[] {
    const noncesResearched: bigint[] = [];
    for (let i = lastNonce + 1n; i <= currentEventNonce; i++) {
      noncesResearched.push(i);
    }
    return noncesResearched;
  }

  /**
   * Filter events by nonce (following Go code pattern)
   */
  private filterEvents(events: EventLog[], nonce: bigint): EventLog[] {
    const filtered: EventLog[] = [];
    for (const e of events) {
      const eventNonce = e.args.eventNonce ?? e.args.nonce ?? 0n;
      if (eventNonce > nonce) {
        filtered.push(e);
      }
    }
    return filtered;
  }

  /**
   * Get factory events from blockchain in order of most likely to be used
   * Stops early if all nonces have been found to optimize RPC calls
   * Following Go code pattern exactly
   */
  private async getFactoryEvents(
    client: PublicClient,
    contractAddress: `0x${string}`,
    fromBlock: bigint,
    toBlock: bigint,
    lastNonce: bigint,
    noncesResearched: bigint[],
  ): Promise<EventLog[]> {
    const newEvents: EventLog[] = [];
    const noncesFound: bigint[] = [];

    console.log('Deposit events');
    // 1. Deposit events (most frequent)
    const depositEvents = await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        'event Deposit(address indexed vault, address user, uint256 depositAmount, uint256 sharesOut, uint256[] amountsOut, uint256[] valuesPerAsset, uint256 eventNonce, uint256 eventHeight)',
      ]),
    });

    for (const log of depositEvents) {
      const ev = log as EventLog;
      newEvents.push(ev);
      const nonce = ev.args.eventNonce ?? ev.args.nonce ?? 0n;
      if (nonce > lastNonce && noncesResearched.includes(nonce)) {
        noncesFound.push(nonce);
      }
    }

    if (noncesFound.length === noncesResearched.length) {
      this.logger.debug('All nonces found early - optimized RPC calls');
      return newEvents;
    }

    console.log('Redeem events');

    // 2. Redeem events
    const redeemEvents = await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        'event Redeem(address indexed vault, address user, uint256 sharesIn, uint256 depositOut, uint256[] soldAmounts, uint256 eventNonce, uint256 eventHeight)',
      ]),
    });

    for (const log of redeemEvents) {
      const ev = log as EventLog;
      newEvents.push(ev);
      const nonce = ev.args.eventNonce ?? ev.args.nonce ?? 0n;
      if (nonce > lastNonce && noncesResearched.includes(nonce)) {
        noncesFound.push(nonce);
      }
    }

    if (noncesFound.length === noncesResearched.length) {
      this.logger.debug('All nonces found early - optimized RPC calls');
      return newEvents;
    }

    console.log('ETFCreated events');
    // 3. ETFCreated events
    const etfCreatedEvents = await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        'event ETFCreated(address indexed vault, uint256 eventNonce, uint256 eventHeight, uint256 etfNonce, address shareToken, string name, string symbol)',
      ]),
    });

    for (const log of etfCreatedEvents) {
      const ev = log as EventLog;
      newEvents.push(ev);
      const nonce = ev.args.eventNonce ?? ev.args.nonce ?? 0n;
      if (nonce > lastNonce && noncesResearched.includes(nonce)) {
        noncesFound.push(nonce);
      }
    }

    if (noncesFound.length === noncesResearched.length) {
      this.logger.debug('All nonces found early - optimized RPC calls');
      return newEvents;
    }

    console.log('Rebalance events');

    // 4. Rebalance events
    const rebalanceEvents = await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        'event Rebalance(address indexed vault, address user, uint256 fromIndex, uint256 toIndex, uint256 moveValue, uint256 eventNonce, uint256 eventHeight, uint256 bought)',
      ]),
    });

    for (const log of rebalanceEvents) {
      const ev = log as EventLog;
      newEvents.push(ev);
      const nonce = ev.args.eventNonce ?? ev.args.nonce ?? 0n;
      if (nonce > lastNonce && noncesResearched.includes(nonce)) {
        noncesFound.push(nonce);
      }
    }

    if (noncesFound.length === noncesResearched.length) {
      this.logger.debug('All nonces found early - optimized RPC calls');
      return newEvents;
    }

    // 5. ParamsUpdated events
    const paramsUpdatedEvents = await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
      events: parseAbi([
        'event ParamsUpdated(address indexed vault, uint256 imbalanceThresholdBps, uint256 maxPriceStaleness, uint256 hlsBalance, uint256 eventNonce, uint256 eventHeight)',
      ]),
    });

    for (const log of paramsUpdatedEvents) {
      const ev = log as EventLog;
      newEvents.push(ev);
    }

    return newEvents;
  }

  /**
   * Save a single event to database
   */
  private async saveEvent(log: EventLog, chainId: ChainId): Promise<void> {
    const vault = log.args.vault;
    const normalizedVault = vault ? normalizeEthAddress(vault) : undefined;
    const etf = normalizedVault
      ? await this.etfModel.findOne({ vault: normalizedVault })
      : undefined;
    const depositDecimals = etf?.depositDecimals ?? 18;
    const shareTokenDecimals = etf?.shareDecimals ?? 18;

    const eventData: Partial<Event> = {
      type: log.eventName,
      chain: Number(chainId),
      user: log.args.user ? normalizeEthAddress(log.args.user) : undefined,
      token: log.args.token ? normalizeEthAddress(log.args.token) : undefined,
      amount: log.args.amount
        ? this.vaultUtils.formatTokenAmount(log.args.amount, 18)
        : undefined,
      nonce: (log.args.eventNonce ?? log.args.nonce ?? 0n).toString(),
      blockNumber: log.blockNumber.toString(),
      vault: normalizedVault ?? undefined,
      depositAmount: log.args.depositAmount
        ? this.vaultUtils.formatTokenAmount(
            log.args.depositAmount,
            depositDecimals,
          )
        : undefined,
      sharesOut: log.args.sharesOut
        ? this.vaultUtils.formatTokenAmount(
            log.args.sharesOut,
            shareTokenDecimals,
          )
        : undefined,
      sharesIn: log.args.sharesIn
        ? this.vaultUtils.formatTokenAmount(
            log.args.sharesIn,
            shareTokenDecimals,
          )
        : undefined,
      depositOut: log.args.depositOut
        ? this.vaultUtils.formatTokenAmount(
            log.args.depositOut,
            depositDecimals,
          )
        : undefined,
      amountsOut: log.args.amountsOut
        ? log.args.amountsOut
            .map((amount) => this.vaultUtils.formatTokenAmount(amount, 18))
            .filter((val): val is string => val !== undefined)
        : undefined,
      valuesPerAsset: log.args.valuesPerAsset
        ? log.args.valuesPerAsset
            .map((value) => this.vaultUtils.formatTokenAmount(value, 18))
            .filter((val): val is string => val !== undefined)
        : undefined,
      soldAmounts: log.args.soldAmounts
        ? log.args.soldAmounts
            .map((amount) => this.vaultUtils.formatTokenAmount(amount, 18))
            .filter((val): val is string => val !== undefined)
        : undefined,
      fromIndex: log.args.fromIndex?.toString(),
      toIndex: log.args.toIndex?.toString(),
      moveValue: log.args.moveValue
        ? this.vaultUtils.formatTokenAmount(log.args.moveValue, 18)
        : undefined,
      bought: log.args.bought
        ? this.vaultUtils.formatTokenAmount(log.args.bought, 18)
        : undefined,
      imbalanceThresholdBps: log.args.imbalanceThresholdBps?.toString(),
      maxPriceStaleness: log.args.maxPriceStaleness?.toString(),
      hlsBalance: log.args.hlsBalance
        ? this.vaultUtils.formatTokenAmount(log.args.hlsBalance, 18)
        : undefined,
      eventHeight: log.args.eventHeight?.toString(),
      etfNonce: log.args.etfNonce?.toString(),
      shareToken: log.args.shareToken ? normalizeEthAddress(log.args.shareToken) : undefined,
      depositToken: log.args.depositToken ? normalizeEthAddress(log.args.depositToken) : undefined,
      name: log.args.name ?? undefined,
      symbol: log.args.symbol ?? undefined,
    };

    await this.eventModel.create(eventData);
  }

  /**
   * Save or update a wallet holding
   */
  private async saveWalletHolding(
    walletHolding: WalletHoldingData,
    existingWalletSet: Set<string>,
  ): Promise<void> {
    const deposits = (walletHolding.deposits || []).map((deposit: any) => ({
      chain: deposit.chain,
      symbol: deposit.symbol,
      decimals: deposit.decimals ?? 18,
      etfVaultAddress: deposit.etfVaultAddress 
        ? normalizeEthAddress(deposit.etfVaultAddress) 
        : deposit.symbol,
      etfTokenAddress: deposit.etfTokenAddress 
        ? normalizeEthAddress(deposit.etfTokenAddress)
        : deposit.etfVaultAddress 
          ? normalizeEthAddress(deposit.etfVaultAddress) 
          : deposit.symbol,
      amount: deposit.amount?.toString() ?? '0',
      amountUSD: deposit.amountUSD ?? 0,
    }));

    if (existingWalletSet.has(walletHolding.wallet)) {
      // Update existing
      const updateOp: any = {
        $set: {
          deposits,
        },
      };

      if (walletHolding.createEtfCount !== undefined) {
        updateOp.$set.createEtfCount = walletHolding.createEtfCount;
      }

      if (walletHolding.depositCount !== undefined) {
        updateOp.$set.depositCount = walletHolding.depositCount;
      }

      if (walletHolding.redeemCount !== undefined) {
        updateOp.$set.redeemCount = walletHolding.redeemCount;
      }

      if (walletHolding.rebalanceCount !== undefined) {
        updateOp.$set.rebalanceCount = walletHolding.rebalanceCount;
      }

      if (walletHolding.volumeTradedUSD !== undefined) {
        updateOp.$set.volumeTradedUSD = walletHolding.volumeTradedUSD;
      }

      if (walletHolding.tvl !== undefined) {
        updateOp.$set.tvl = walletHolding.tvl;
      }

      await this.walletHoldingModel.updateOne(
        { _id: walletHolding._id },
        updateOp,
      );
    } else {
      // Insert new
      await this.walletHoldingModel.create({
        wallet: normalizeEthAddress(walletHolding.wallet),
        deposits,
        rewards: [],
        tvl: walletHolding.tvl ?? 0,
        createEtfCount: walletHolding.createEtfCount ?? 0,
        depositCount: walletHolding.depositCount ?? 0,
        redeemCount: walletHolding.redeemCount ?? 0,
        rebalanceCount: walletHolding.rebalanceCount ?? 0,
        volumeTradedUSD: walletHolding.volumeTradedUSD || 0,
      });
      existingWalletSet.add(normalizeEthAddress(walletHolding.wallet));
    }
  }

  /**
   * Update observed nonce for a chain
   */
  private async updateObservedNonce(
    chainId: ChainId,
    nonce: bigint,
    blockNumber: bigint,
    latestBlock: bigint,
  ): Promise<void> {
    const savedToBlock =
      blockNumber >= latestBlock ? latestBlock : blockNumber;

    await this.observeEventsModel.findOneAndUpdate(
      { chain: Number(chainId) },
      {
        chain: Number(chainId),
        lastBlockNumber: savedToBlock.toString(),
        lastNonce: nonce.toString(),
      },
      { upsert: true },
    );
  }

  /**
   * Process events and save them one by one
   */
  private async processEvents(
    events: EventLog[],
    chainId: ChainId,
    client: PublicClient,
    holdingsMap: Map<string, WalletHoldingData>,
    existingWalletSet: Set<string>,
    latestBlock: bigint,
  ): Promise<void> {
    for (const log of events) {
      try {
        // Process the event
        switch (log.eventName) {
          case 'Deposit':
            await this.processDepositEvent(log, chainId, client, holdingsMap);
            // Save wallet holding if it was modified
            const depositUser = log.args.user;
            if (depositUser) {
              const walletHolding = holdingsMap.get(depositUser);
              if (walletHolding) {
                await this.saveWalletHolding(walletHolding, existingWalletSet);
              }
            }
            break;
          case 'Redeem':
            await this.processRedeemEvent(log, chainId, client, holdingsMap);
            // Save wallet holding if it was modified
            const redeemUser = log.args.user;
            if (redeemUser) {
              const walletHolding = holdingsMap.get(redeemUser);
              if (walletHolding) {
                await this.saveWalletHolding(walletHolding, existingWalletSet);
              }
            }
            break;
          case 'ETFCreated':
            await this.processETFCreatedEvent(log, chainId, client, holdingsMap);
            // Save wallet holdings that were modified (if any)
            if (log.transactionHash) {
              try {
                const tx = await client.getTransaction({ hash: log.transactionHash });
                if (tx.from) {
                  const walletHolding = holdingsMap.get(tx.from);
                  if (walletHolding) {
                    await this.saveWalletHolding(walletHolding, existingWalletSet);
                  }
                }
              } catch (error) {
                // Error already logged in processETFCreatedEvent
              }
            }
            break;
          case 'Rebalance':
            await this.processRebalanceEvent(log, chainId, client, holdingsMap);
            // Save all wallet holdings that were modified
            const { vault } = log.args;
            if (vault) {
              try {
                const normalizedVault = normalizeEthAddress(vault);
                const walletHoldings = await this.walletHoldingModel
                  .find({
                    'deposits.etfVaultAddress': normalizedVault,
                    'deposits.chain': Number(chainId),
                  })
                  .lean()
                  .exec();
                for (const holding of walletHoldings) {
                  const walletHolding = holdingsMap.get(holding.wallet);
                  if (walletHolding) {
                    await this.saveWalletHolding(walletHolding, existingWalletSet);
                  }
                }
              } catch (error) {
                // Error already logged in processRebalanceEvent
              }
            }
            break;
          case 'ParamsUpdated':
            await this.processParamsUpdatedEvent(log, chainId, client);
            break;
          default:
            this.logger.warn(`Unknown event type: ${log.eventName}`);
        }

        // Save the event
        await this.saveEvent(log, chainId);

        // Update observed nonce after each event
        const eventNonce = log.args.eventNonce ?? log.args.nonce ?? 0n;
        await this.updateObservedNonce(
          chainId,
          eventNonce,
          log.blockNumber,
          latestBlock,
        );
      } catch (error) {
        this.logger.error(`Error processing event ${log.eventName}:`, error);
        // Continue processing other events even if one fails
      }
    }
  }

  /**
   * Update ETF portfolio values if not updated in the last minute
   */
  private async updateETFPortfolio(
    chainId: ChainId,
    client: PublicClient,
    vaultAddresses: Set<string>,
  ): Promise<void> {
    if (vaultAddresses.size === 0) return;

    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

    // Update each ETF individually
    for (const vaultAddress of vaultAddresses) {
      try {
        const normalizedVaultAddress = normalizeEthAddress(vaultAddress);
        // Find ETF that needs updating (not updated in the last minute)
        const etf = await this.etfModel.findOne({
          vault: normalizedVaultAddress,
          chain: Number(chainId),
          $or: [
            { updatedAt: { $lt: oneMinuteAgo } },
            { updatedAt: { $exists: false } },
            { volumeTradedUSD: 0 },
            { sharePrice: { $not: { $exists: true } } },
          ],
        });

        if (!etf) {
          continue;
        }

        const portfolio = await this.vaultUtils.fetchVaultPortfolio(
          client,
          etf.vault as `0x${string}`,
          etf.shareDecimals,
        );

        // Update assets with their TVL values
        const updatedAssets =
          etf.assets?.map((asset, index) => ({
            token: asset.token,
            feed: asset.feed,
            targetWeightBps: asset.targetWeightBps,
            v2Path: asset.v2Path || [],
            v3Path: asset.v3Path || '',
            v3PoolFee: asset.v3PoolFee || 0,
            symbol: asset.symbol,
            decimals: asset.decimals,
            tvl: portfolio.valuesPerAsset[index] ?? '0',
          })) ?? [];

        // Update ETF
        // Note: portfolio.totalValue is a string, but tvl in schema is Number
        // MongoDB will convert string to number automatically
        await this.etfModel.updateOne(
          { _id: etf._id },
          {
            $set: {
              tvl: Number(portfolio.totalValue),
              sharePrice: Number(portfolio.nav),
              assets: updatedAssets,
            },
          },
        );

        this.logger.debug(
          `Updated portfolio for ETF ${etf.vault}: TVL=${portfolio.totalValue}, NAV=${portfolio.nav}`,
        );
      } catch (error) {
        this.logger.error(
          `Error updating portfolio for ETF ${vaultAddress}:`,
          error,
        );
      }
    }
  }

  /**
   * Sync to target height following Go code pattern exactly
   */
  private async syncToTargetHeight(
    chainId: ChainId,
    client: PublicClient,
    lastObservedEthHeight: bigint,
    targetHeight: bigint,
    latestHeight: bigint,
    ethBlockConfirmationDelay: bigint,
  ): Promise<{ lastObservedEthHeight: bigint; error?: Error }> {
    if (targetHeight - lastObservedEthHeight === 0n) {
      this.logger.debug(`No blocks to sync on chain ${chainId}`);
      return { lastObservedEthHeight: targetHeight };
    }

    // Get last observed event nonce from ObserveEvents (source of truth, like Helios in Go code)
    const observeProgress = await this.observeEventsModel.findOne({
      chain: Number(chainId),
    });
    const lastObservedEventNonce = observeProgress
      ? BigInt(observeProgress.lastNonce ?? '0')
      : 0n;

    // Get latest event nonce from contract
    let latestEventNonce: bigint;
    try {
      latestEventNonce = (await client.readContract({
        address: ETF_CONTRACT_ADDRS[chainId] as `0x${string}`,
        abi: parseAbi([
          'function state_lastEventNonce() view returns (uint256)',
        ]),
        functionName: 'state_lastEventNonce',
      })) as bigint;
    } catch (error: any) {
      if (error?.message?.includes('no contract code')) {
        this.logger.warn(
          'No contract code at given address, rotating RPC might be needed',
        );
      }
      this.logger.error(`Failed to get last event nonce on chain ${chainId}:`, error);
      return { lastObservedEthHeight, error: error as Error };
    }

    // Skip optimization: if nonces match, skip RPC calls
    if (
      !this.missedEventsBlockHeight.has(chainId) ||
      this.missedEventsBlockHeight.get(chainId) === 0n
    ) {
      if (lastObservedEventNonce === latestEventNonce) {
        this.logger.debug(`No new events on chain ${chainId} (nonces match)`);
        return { lastObservedEthHeight: targetHeight };
      } else {
        // Special case to reduce the number of calls to the ethereum rpc
        // We can miss events if we don't rewind few minutes
        // blockTimeOnTheChain is in milliseconds
        const blockTimeOnTheChain = AVERAGE_BLOCK_TIME_MS[chainId];

        // compute number of blocks in 2 minutes
        const twoMinutesMs = 2n * 60n * 1000n; // 120000 ms

        const nbBlocksToRewind = twoMinutesMs / blockTimeOnTheChain;

        this.logger.debug(`Rewinding last observed height by ${nbBlocksToRewind} blocks on chain ${chainId}`);
        // rewind the last observed height
        lastObservedEthHeight =
          lastObservedEthHeight > nbBlocksToRewind
            ? lastObservedEthHeight - nbBlocksToRewind
            : 0n;
      }
    }

    // Get all nonces between lastObservedEventNonce and latestEventNonce to optimize the number of calls to the ethereum rpc
    const noncesResearched = this.getNoncesResearched(
      lastObservedEventNonce,
      latestEventNonce,
    );

    this.logger.debug(`Researching ${noncesResearched.length} nonces on chain ${chainId}`);

    const contractAddress = ETF_CONTRACT_ADDRS[chainId] as `0x${string}`;

    // Get events from blockchain
    let events: EventLog[];
    try {
      events = await this.getFactoryEvents(
        client,
        contractAddress,
        lastObservedEthHeight,
        targetHeight,
        lastObservedEventNonce,
        noncesResearched,
      );
    } catch (error) {
      this.logger.error(`Failed to get events on chain ${chainId}:`, error);
      return { lastObservedEthHeight, error: error as Error };
    }

    const newEvents = this.filterEvents(events, lastObservedEventNonce);
    this.logger.debug(`Found ${newEvents.length} new events on chain ${chainId} (from ${events.length} total)`);

    // Sort events by nonce
    newEvents.sort((a, b) => {
      const nonceA = a.args.eventNonce ?? a.args.nonce ?? 0n;
      const nonceB = b.args.eventNonce ?? b.args.nonce ?? 0n;
      return nonceA < nonceB ? -1 : nonceA > nonceB ? 1 : 0;
    });

    if (newEvents.length === 0) {
      this.logger.debug(`No new events on chain ${chainId} (blocks ${lastObservedEthHeight}-${targetHeight})`);
      return { lastObservedEthHeight: targetHeight };
    }

    this.logger.log(`Processing ${newEvents.length} new events on chain ${chainId}`);

    // Check for missed events (nonce gap detection)
    const firstEventNonce =
      newEvents[0].args.eventNonce ?? newEvents[0].args.nonce ?? 0n;
    if (firstEventNonce > lastObservedEventNonce + 1n) {
      // we missed an event
      const observeProgress = await this.observeEventsModel.findOne({
        chain: Number(chainId),
      });
      const lastObservedHeight = observeProgress
        ? BigInt(observeProgress.lastBlockNumber ?? '0')
        : DEFAULT_START_BLOCKS[chainId];

      // if we missed an event, we need to rewind the last observed height by 5 minutes and continue from there
      if (
        !this.missedEventsBlockHeight.has(chainId) ||
        this.missedEventsBlockHeight.get(chainId) === 0n
      ) {
        this.missedEventsBlockHeight.set(chainId, lastObservedHeight);
      } else {
        // blockTimeOnTheChain is in milliseconds
        const blockTimeOnTheChain = AVERAGE_BLOCK_TIME_MS[chainId];

        // compute number of blocks in 5 minutes
        const fiveMinutesMs = 5n * 60n * 1000n; // 300000 ms

        const nbBlocksToRewind = fiveMinutesMs / blockTimeOnTheChain;

        const currentMissedHeight =
          this.missedEventsBlockHeight.get(chainId) ?? lastObservedHeight;
        this.missedEventsBlockHeight.set(
          chainId,
          currentMissedHeight > nbBlocksToRewind
            ? currentMissedHeight - nbBlocksToRewind
            : 0n,
        );
      }

      const rewindHeight =
        this.missedEventsBlockHeight.get(chainId) ?? lastObservedHeight;
      this.logger.warn(
        `Missed event on chain ${chainId}. Rewinding to block ${rewindHeight} (nonce gap: ${lastObservedEventNonce} -> ${firstEventNonce})`,
      );
      return {
        lastObservedEthHeight: rewindHeight,
        error: new Error('missed an event'),
      };
    }

    // Clear missed events block height since we found events in sequence
    this.missedEventsBlockHeight.set(chainId, 0n);

    // Collect all unique wallet addresses
    const walletAddresses = new Set<string>();
    for (const log of newEvents) {
      const user = log.args.user;
      if (user) walletAddresses.add(normalizeEthAddress(user));
    }

    // Fetch all existing wallet holdings in one query
    const existingHoldings = await this.walletHoldingModel.find({
      wallet: { $in: Array.from(walletAddresses) },
    });
    const holdingsMap = new Map<string, WalletHoldingData>();
    const existingWalletSet = new Set<string>();
    for (const holding of existingHoldings) {
      const normalizedWallet = normalizeEthAddress(holding.wallet);
      holdingsMap.set(normalizedWallet, {
        wallet: normalizedWallet,
        deposits: holding.deposits,
        rewards: holding.rewards,
        createEtfCount: holding.createEtfCount ?? 0,
        depositCount: holding.depositCount ?? 0,
        redeemCount: holding.redeemCount ?? 0,
        rebalanceCount: holding.rebalanceCount ?? 0,
        volumeTradedUSD: holding.volumeTradedUSD,
        tvl: holding.tvl,
        _id: holding._id,
      });
      existingWalletSet.add(normalizedWallet);
    }

    // Process all events one by one, saving each immediately
    await this.processEvents(
      newEvents,
      chainId,
      client,
      holdingsMap,
      existingWalletSet,
      latestHeight,
    );

    return { lastObservedEthHeight: targetHeight };
  }

  /**
   * Observe and process lending events for a specific chain
   * Following Go code pattern exactly
   */
  private async observeEvents(
    chainId: ChainId,
    client: PublicClient,
  ): Promise<void> {
    if (DEFAULT_START_BLOCKS[chainId] == 0n) return;

    // Get or create observe progress for this chain
    const observeProgress = await this.observeEventsModel.findOne({
      chain: Number(chainId),
    });

    // Get last event for nonce tracking
    const lastEventObserved = await this.eventModel
      .findOne({
        chain: Number(chainId),
      })
      .sort({ blockNumber: -1, nonce: -1 });

    // Determine starting block number (lastObservedEthHeight)
    let lastObservedEthHeight: bigint;
    if (observeProgress) {
      // Use saved progress
      lastObservedEthHeight = BigInt(
        observeProgress.lastBlockNumber ?? '0',
      );
    } else {
      // First time: use last event block or default start block
      lastObservedEthHeight = lastEventObserved?.blockNumber
        ? BigInt(lastEventObserved.blockNumber)
        : DEFAULT_START_BLOCKS[chainId];
    }

    // Get latest block number
    let latestHeight: bigint;
    try {
      latestHeight = await client.getBlockNumber();
    } catch (error) {
      this.logger.error(`Failed to get latest height on chain ${chainId}:`, error);
      return;
    }

    // Ensure that latest block has minimum confirmations
    const ethBlockConfirmationDelay = ETH_BLOCK_CONFIRMATION_DELAY;
    let targetHeight = latestHeight;

    // not enough blocks on ethereum yet
    if (targetHeight <= ethBlockConfirmationDelay) {
      this.logger.debug(`Not enough blocks on chain ${chainId} yet`);
      return;
    }

    // ensure that latest block has minimum confirmations
    targetHeight = targetHeight - ethBlockConfirmationDelay;

    if (targetHeight <= lastObservedEthHeight) {
      this.logger.debug(`Chain ${chainId} synced (${lastObservedEthHeight} -> ${targetHeight})`);
      return;
    }

    // Sync in chunks following Go code pattern
    const defaultBlocksToSearch = DEFAULT_BLOCKS_TO_SEARCH;
    let targetHeightForSync = targetHeight;

    for (let i = 0; i < 100 && latestHeight > targetHeightForSync; i++) {
      if (targetHeightForSync > lastObservedEthHeight + defaultBlocksToSearch) {
        targetHeightForSync = lastObservedEthHeight + defaultBlocksToSearch;
      }

      const result = await this.syncToTargetHeight(
        chainId,
        client,
        lastObservedEthHeight,
        targetHeightForSync,
        latestHeight,
        ethBlockConfirmationDelay,
      );

      if (result.error) {
        if (result.error.message === 'missed an event') {
          // Restart from rewinded height
          lastObservedEthHeight = result.lastObservedEthHeight;
          // Continue the loop to retry
          continue;
        } else {
          // Other errors, return
          this.logger.error('Error in syncToTargetHeight:', result.error);
          return;
        }
      }

      lastObservedEthHeight = result.lastObservedEthHeight;
      targetHeightForSync = targetHeightForSync + defaultBlocksToSearch;
    }

    // Save progress to database
    const finalLastEvent = await this.eventModel
      .findOne({
        chain: Number(chainId),
      })
      .sort({ blockNumber: -1, nonce: -1 });

    const finalNonce = finalLastEvent?.nonce
      ? BigInt(finalLastEvent.nonce)
      : 0n;
    const savedToBlock =
      lastObservedEthHeight >= latestHeight
        ? latestHeight
        : lastObservedEthHeight;

    await this.observeEventsModel.findOneAndUpdate(
      { chain: Number(chainId) },
      {
        chain: Number(chainId),
        lastBlockNumber: savedToBlock.toString(),
        lastNonce: finalNonce.toString(),
      },
      { upsert: true },
    );
  }

  @Cron('*/12 * * * * *') // Every 12 seconds
  async handleEventProcessing(): Promise<void> {
    this.logger.log('handleEventProcessing - cron triggered');
    // Check if job is already running
    if (this.isRunning) {
      this.logger.debug('Event job is already running, skipping this execution');
      return;
    }

    // Set mutex flag
    this.isRunning = true;

    try {
      if (!this.startup) {
        // Only run once on startup (to advance the last observed height if no new events were found)
        this.startup = true;
        for (const chainId of [ChainId.MAINNET, ChainId.ARBITRUM]) {
          const client = this.web3Service.getPublicClient(chainId);
          const observeProgress = await this.observeEventsModel.findOne({
            chain: Number(chainId),
          });
          if (!observeProgress) {
            continue;
          }
          const lastEventNonce = (await client.readContract({
            address: ETF_CONTRACT_ADDRS[chainId] as `0x${string}`,
            abi: parseAbi([
              'function state_lastEventNonce() view returns (uint256)',
            ]),
            functionName: 'state_lastEventNonce',
          })) as bigint;

          const lastObservedNonce = BigInt(observeProgress.lastNonce ?? '0');
          if (lastEventNonce <= lastObservedNonce) {
            const latestObservedHeight = await client.getBlockNumber();
            await this.observeEventsModel.findOneAndUpdate(
              { chain: Number(chainId) },
              {
                $set: {
                  lastBlockNumber: latestObservedHeight.toString(),
                  lastNonce: lastEventNonce.toString(),
                },
              },
              { upsert: true },
            );
          }
        }
      }

      await Promise.all(
        [ChainId.MAINNET, ChainId.ARBITRUM].map(async (chainId) => {
          const client = this.web3Service.getPublicClient(chainId);
          await this.observeEvents(chainId, client);
        }),
      );
    } catch (error) {
      // Enhanced error handling for MongoDB and other errors
      if (error instanceof Error) {
        // Check if it's a MongoDB connection error
        const errorMessage = error.message.toLowerCase();
        if (
          errorMessage.includes('mongodb') ||
          errorMessage.includes('connection') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('network')
        ) {
          this.logger.error(
            `MongoDB error in event processing job: ${error.message}`,
            error.stack,
          );
          // Don't crash the job, it will retry on next execution
        } else {
          this.logger.error(
            `Error in event processing job: ${error.message}`,
            error.stack,
          );
        }
      } else {
        this.logger.error('Unknown error in event processing job:', error);
      }
      // Job will continue on next cron execution
    } finally {
      // Always release mutex flag
      this.isRunning = false;
    }
  }
}
