import { Controller } from '@nestjs/common';
import { RewardsService } from './rewards.service';

/**
 * Controller pour les routes /api/rewards
 * TODO: Implémenter les endpoints depuis l'ancienne app Express
 */
@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  // TODO: Migrer les routes depuis routes/rewards de l'ancienne app
}
