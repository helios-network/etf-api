import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { handleError } from 'src/utils/error';

import { RewardsService } from './rewards.service';
import { ClaimRewardDto } from './dto/claim-reward.dto';

@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) { }

  @Get('rewards_boost')
  async getRewardsBoost() {
    try {
      return await this.rewardsService.getRewardsBoost();
    } catch (error) {
      handleError(error)
    }
  }

  @Get(':address')
  async getWalletRewards(@Param('address') address: string) {
    try {
      return await this.rewardsService.getWalletRewards(address);
    } catch (error) {
      handleError(error)
    }
  }

  @Get(':address/total-points')
  async getUserTotalPoints(@Param('address') address: string) {
    try {
      return await this.rewardsService.getUserTotalPoints(address);
    } catch (error) {
      handleError(error)
    }
  }

  @Post(':address/claim/:symbol')
  async claimReward(
    @Param('address') address: string,
    @Param('symbol') symbol: string,
    @Body() body: ClaimRewardDto,
  ) {
    try {
      const result = await this.rewardsService.claimReward(
        address,
        symbol,
        body.chainId,
        body.signature,
      );

      if (!result.success) {
        throw new HttpException(result, HttpStatus.BAD_REQUEST);
      }

      return result;
    } catch (error) {
      handleError(error)
    }
  }
}
