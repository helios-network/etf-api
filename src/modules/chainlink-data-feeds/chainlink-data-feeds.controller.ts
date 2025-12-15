import { Controller } from '@nestjs/common';
import { ChainlinkDataFeedsService } from './chainlink-data-feeds.service';

/**
 * Controller pour les routes /api/chainlinkDataFeeds
 * TODO: Implémenter les endpoints depuis l'ancienne app Express
 */
@Controller('chainlinkDataFeeds')
export class ChainlinkDataFeedsController {
  constructor(
    private readonly chainlinkDataFeedsService: ChainlinkDataFeedsService,
  ) {}

  // TODO: Migrer les routes depuis routes/chainlinkDataFeeds de l'ancienne app
}
