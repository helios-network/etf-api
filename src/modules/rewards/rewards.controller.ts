import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { ClaimRewardDto } from './dto/claim-reward.dto';

@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get('rewards_boost')
  async getRewardsBoost() {
    try {
      return await this.rewardsService.getRewardsBoost();
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':address')
  async getWalletRewards(@Param('address') address: string) {
    try {
      return await this.rewardsService.getWalletRewards(address);
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
