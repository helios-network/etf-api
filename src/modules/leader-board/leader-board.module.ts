import { Module } from '@nestjs/common';
import { LeaderBoardController } from './leader-board.controller';
import { LeaderBoardService } from './leader-board.service';

@Module({
  controllers: [LeaderBoardController],
  providers: [LeaderBoardService],
  exports: [LeaderBoardService],
})
export class LeaderBoardModule {}
