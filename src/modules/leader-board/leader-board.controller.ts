import { Controller } from '@nestjs/common';
import { LeaderBoardService } from './leader-board.service';

/**
 * Controller pour les routes /api/leaderBoard
 * TODO: Implémenter les endpoints depuis l'ancienne app Express
 */
@Controller('leaderBoard')
export class LeaderBoardController {
  constructor(private readonly leaderBoardService: LeaderBoardService) {}

  // TODO: Migrer les routes depuis routes/leaderBoard de l'ancienne app
}
