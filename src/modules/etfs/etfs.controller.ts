import { Controller } from '@nestjs/common';
import { EtfsService } from './etfs.service';

/**
 * Controller pour les routes /api/etfs
 * TODO: Implémenter les endpoints depuis l'ancienne app Express
 */
@Controller('etfs')
export class EtfsController {
  constructor(private readonly etfsService: EtfsService) {}

  // TODO: Migrer les routes depuis routes/etfs de l'ancienne app
}
