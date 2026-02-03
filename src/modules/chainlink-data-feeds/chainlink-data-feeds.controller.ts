import {
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { handleError } from 'src/utils/error';

import { ChainlinkDataFeedsService } from './chainlink-data-feeds.service';

@Controller('chainlinkDataFeeds')
export class ChainlinkDataFeedsController {
  constructor(
    private readonly chainlinkDataFeedsService: ChainlinkDataFeedsService,
  ) { }

  @Get()
  async getAll(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('chainId') chainId?: string,
    @Query('feedCategory') feedCategory?: string,
    @Query('feedType') feedType?: string,
    @Query('status') status?: string,
  ) {
    try {
      const pageNum = parseInt(page || '1', 10);
      const sizeNum = parseInt(size || '10', 10);
      const chainIdNum = chainId ? parseInt(chainId, 10) : undefined;

      const result = await this.chainlinkDataFeedsService.getAll(
        pageNum,
        sizeNum,
        chainIdNum,
        feedCategory,
        feedType,
        status,
      );

      return result;
    } catch (error) {
      handleError(error)
    }
  }

  @Post('reload')
  async reloadFeeds() {
    try {
      return await this.chainlinkDataFeedsService.reloadFeeds();
    } catch (error) {
      handleError(error)
    }
  }
}
