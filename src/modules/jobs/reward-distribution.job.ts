import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  LeaderBoardRewards,
  LeaderBoardRewardsDocument,
} from '../../models/leader-board-rewards.schema';
import {
  WalletHolding,
  WalletHoldingDocument,
} from '../../models/wallet-holding.schema';

const BATCH_SIZE = 1000; // Number of documents to process per batch

@Injectable()
export class RewardDistributionJob {
  constructor(
    @InjectModel(LeaderBoardRewards.name)
    private leaderBoardRewardsModel: Model<LeaderBoardRewardsDocument>,
    @InjectModel(WalletHolding.name)
    private walletHoldingModel: Model<WalletHoldingDocument>,
  ) {}

  /**
   * Calculate the timestamp of the start of the current day (midnight)
   */
  private getCurrentTime(): number {
    return (
      Math.floor(Date.now() / (1000 * 60 * 60 * 24)) * (1000 * 60 * 60 * 24)
    );
  }

  /**
   * Get the active pool reward for the given date
   */
  private async getActivePoolReward(currentTime: number) {
    return await this.leaderBoardRewardsModel.findOne({
      startDate: { $lte: currentTime },
      endDate: { $gte: currentTime },
    });
  }

  /**
   * Build the MongoDB query to find wallets with holdings
   */
  private buildQuery(type: string, chain: number, symbol: string) {
    return {
      [type]: {
        $elemMatch: {
          chain,
          symbol,
          amount: { $gt: '0' }, // Compare as string in new schema
        },
      },
    };
  }

  /**
   * Calculate the daily reward based on the total duration of the pool
   */
  private calculateDailyReward(poolReward: any): bigint {
    const daysDuration = Math.floor(
      (poolReward.endDate - poolReward.startDate) / (1000 * 60 * 60 * 24),
    );
    return BigInt(poolReward.totalReward.quantity) / BigInt(daysDuration);
  }

  /**
   * Get the amount of a wallet for a given type, chain and symbol
   */
  private getWalletAmount(
    walletHolding: any,
    type: string,
    chain: number,
    symbol: string,
  ): bigint {
    const item = walletHolding?.[type]?.find(
      (item: any) => item.chain === chain && item.symbol === symbol,
    );
    return item ? BigInt(item.amount ?? '0') : 0n;
  }

  /**
   * Calculate the total parts in batches
   * (first pass to know the total before distribution)
   */
  private async calculateTotalParts(
    query: any,
    type: string,
    chain: number,
    symbol: string,
  ): Promise<bigint> {
    let totalParts = 0n;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const walletHoldings = await this.walletHoldingModel
        .find(query)
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      if (walletHoldings.length === 0) {
        break;
      }

      for (const walletHolding of walletHoldings) {
        const amount = this.getWalletAmount(walletHolding, type, chain, symbol);
        if (amount === 0n) continue; // Skip wallets with no amount
        totalParts += amount;
      }

      skip += BATCH_SIZE;
      hasMore = walletHoldings.length === BATCH_SIZE;
    }

    return totalParts;
  }

  /**
   * Distribute the rewards in batches
   * (second pass to update the wallets)
   */
  private async distributeRewards(
    query: any,
    type: string,
    chain: number,
    symbol: string,
    dailyReward: bigint,
    totalParts: bigint,
    currentTime: number,
  ): Promise<void> {
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const walletHoldings = await this.walletHoldingModel
        .find(query)
        .skip(skip)
        .limit(BATCH_SIZE);

      if (walletHoldings.length === 0) {
        break;
      }

      const bulkOps = walletHoldings.map((walletHolding) => {
        const amount = this.getWalletAmount(
          walletHolding,
          type,
          chain,
          symbol,
        );
        if (amount === 0n) return undefined; // Skip wallets with no amount

        const rewardAmount = (dailyReward * amount) / totalParts;

        return {
          updateOne: {
            filter: { _id: walletHolding._id },
            update: {
              $push: {
                rewards: {
                  chain,
                  symbol,
                  amount: rewardAmount.toString(), // Store as string
                  date: currentTime,
                },
              },
            },
          },
        };
      });

      if (bulkOps.length > 0) {
        await this.walletHoldingModel.bulkWrite(
          bulkOps.filter((op) => op !== undefined) as any[],
        );
      }

      skip += BATCH_SIZE;
      hasMore = walletHoldings.length === BATCH_SIZE;
    }
  }

  /**
   * Main function that orchestrates the reward distribution process
   */
  @Cron('0 0 0 * * *') // Every day at midnight
  async processDailyRewards(): Promise<void> {
    // const currentTime = this.getCurrentTime()

    // const poolReward = await this.getActivePoolReward(currentTime)
    // if (!poolReward) return

    // const type = poolReward.type === "deposit" ? "deposits" : "borrows"
    // const query = this.buildQuery(type, poolReward.chain, poolReward.symbol)
    // const dailyReward = this.calculateDailyReward(poolReward)

    // // First pass: calculate the total parts
    // const totalParts = await this.calculateTotalParts(
    //   query,
    //   type,
    //   poolReward.chain,
    //   poolReward.symbol
    // )

    // if (totalParts === 0n) return

    // // Second pass: distribute the rewards
    // await this.distributeRewards(
    //   query,
    //   type,
    //   poolReward.chain,
    //   poolReward.symbol,
    //   dailyReward,
    //   totalParts,
    //   currentTime
    // )
  }
}
