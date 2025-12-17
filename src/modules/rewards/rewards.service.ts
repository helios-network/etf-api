import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../infrastructure/cache/cache.service';
import {
  WalletHolding,
  WalletHoldingDocument,
} from '../../models/wallet-holding.schema';
import {
  LeaderBoardRewards,
  LeaderBoardRewardsDocument,
} from '../../models/leader-board-rewards.schema';
import { Web3Service } from '../../services/web3.service';
import { ChainId } from '../../config/web3';
import { TRANSACTION_POINTS } from '../../constants/transaction-points';
import { verifyMessage, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { normalizeEthAddress } from '../../common/utils/eip55';

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);
  // Global queue to process all claims sequentially (one at a time)
  private claimQueue: Promise<void> = Promise.resolve();

  constructor(
    @InjectModel(WalletHolding.name)
    private walletHoldingModel: Model<WalletHoldingDocument>,
    @InjectModel(LeaderBoardRewards.name)
    private leaderBoardRewardsModel: Model<LeaderBoardRewardsDocument>,
    private readonly cacheService: CacheService,
    private readonly web3Service: Web3Service,
    private readonly configService: ConfigService,
  ) {}

  async getRewardsBoost() {
    const leaderBoardRewards = await this.leaderBoardRewardsModel
      .find()
      .lean()
      .exec();

    return {
      success: true,
      data: leaderBoardRewards.reverse(),
    };
  }

  async getWalletRewards(address: string) {
    const normalizedAddress = normalizeEthAddress(address);
    const walletHolding = await this.walletHoldingModel.findOne({
      wallet: normalizedAddress,
    });

    if (!walletHolding) {
      return {
        success: false,
        message: 'Wallet not found',
      };
    }

    return {
      success: true,
      data: walletHolding.rewards,
    };
  }

  async getUserTotalPoints(address: string) {
    const normalizedAddress = normalizeEthAddress(address);
    const walletHolding = await this.walletHoldingModel.findOne({
      wallet: normalizedAddress,
    });

    if (!walletHolding) {
      return {
        success: false,
        message: 'Wallet not found',
      };
    }

    const createEtfCount = walletHolding.createEtfCount ?? 0;
    const depositCount = walletHolding.depositCount ?? 0;
    const redeemCount = walletHolding.redeemCount ?? 0;
    const rebalanceCount = walletHolding.rebalanceCount ?? 0;

    const pointsByType = {
      createEtf: createEtfCount * TRANSACTION_POINTS.CREATE_ETF,
      deposit: depositCount * TRANSACTION_POINTS.DEPOSIT,
      redeem: redeemCount * TRANSACTION_POINTS.REDEEM,
      rebalance: rebalanceCount * TRANSACTION_POINTS.REBALANCE,
    };

    const totalPoints =
      pointsByType.createEtf +
      pointsByType.deposit +
      pointsByType.redeem +
      pointsByType.rebalance;

    return {
      success: true,
      data: {
        totalPoints,
        transactionCounts: {
          createEtf: createEtfCount,
          deposit: depositCount,
          redeem: redeemCount,
          rebalance: rebalanceCount,
        },
        pointsByType,
      },
    };
  }

  async claimReward(
    address: string,
    symbol: string,
    chainId: number,
    signature: string,
  ) {
    // Add this claim to the queue - it will wait for all previous claims to complete
    const currentClaim = this.claimQueue.then(async () => {
      try {
        const normalizedAddress = normalizeEthAddress(address);
        const walletHolding = await this.walletHoldingModel.findOne({
          wallet: normalizedAddress,
        });

        if (!walletHolding) {
          return {
            success: false,
            message: 'Wallet not found',
          };
        }

        const rewards = walletHolding.rewards.filter(
          (reward) =>
            reward.chain === Number(chainId) &&
            reward.symbol === symbol &&
            !reward.hash,
        );

        const totalAmount = rewards.reduce(
          (acc, reward) => acc + BigInt(reward.amount),
          0n,
        );

        // const token = SUPPORTED_ASSETS[Number(chainId) as ChainId]?.find(
        //   (asset) => asset.symbol === symbol,
        // );

        // if (!token) {
        //   return {
        //     success: false,
        //     message: 'Token not found',
        //   };
        // }

        const ownerAccount = this.web3Service.getAccount(
          Number(chainId) as ChainId,
        );

        const verified = await verifyMessage({
          address: address as `0x${string}`,
          message: JSON.stringify({
            chainId: Number(chainId),
            symbol,
            amount: totalAmount,
            to: address as `0x${string}`,
          }),
          signature: signature as `0x${string}`,
        });

        if (!verified) {
          return {
            success: false,
            message: 'Invalid signature',
          };
        }

        const walletClient = this.web3Service.getWalletClient(
          Number(chainId) as ChainId,
        );
        const publicClient = this.web3Service.getPublicClient(
          Number(chainId) as ChainId,
        );

        const { request } = await publicClient.simulateContract({
          account: ownerAccount,
          address: `0x0000000000000000000000000000000000000000` as `0x${string}`,//token.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [address as `0x${string}`, totalAmount],
        });

        const tx = await walletClient.writeContract(request);

        await publicClient.waitForTransactionReceipt({
          hash: tx,
        });

        // Update rewards with transaction hash
        const updatedRewards = walletHolding.rewards.map((reward) => {
          if (reward.chain === Number(chainId) && reward.symbol === symbol) {
            return { ...reward, hash: tx };
          }
          return reward;
        });
        walletHolding.rewards = updatedRewards;
        await walletHolding.save();

        // Invalidate cache for this wallet
        await this.cacheService.del(`wallet_rewards:${address.toLowerCase()}`, {
          namespace: 'rewards',
        });

        return {
          success: true,
          data: {
            hash: tx,
          },
        };
      } catch (error) {
        this.logger.error('Error claiming reward:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    // Update the queue to include this claim
    this.claimQueue = currentClaim.then(() => {
      // Queue continues after this claim completes
    });

    // Wait for this claim to complete
    return await currentClaim;
  }
}
