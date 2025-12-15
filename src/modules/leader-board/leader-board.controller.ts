import {
  Controller,
  Get,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { LeaderBoardService } from './leader-board.service';

@Controller('leaderBoard')
export class LeaderBoardController {
  constructor(private readonly leaderBoardService: LeaderBoardService) {}

  @Get()
  async getLeaderBoard(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: string,
  ) {
    try {
      const pageNum = parseInt(page || '1', 10);
      const limitNum = parseInt(limit || '10', 10);
      const sortByField = sortBy || 'points';
      const orderField = (order?.toLowerCase() === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';

      return await this.leaderBoardService.getLeaderBoard(
        pageNum,
        limitNum,
        sortByField,
        orderField,
      );
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
}
