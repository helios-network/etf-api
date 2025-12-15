import { Controller } from '@nestjs/common';
import { EtfsService } from './etfs.service';

/**
 * Controller pour les routes /etf (alias sans préfixe /api)
 * TODO: Implémenter les endpoints depuis l'ancienne app Express
 * Note: Ce controller expose les mêmes routes que EtfsController mais sans préfixe /api
 */
@Controller('etf')
export class EtfController {
  constructor(private readonly etfsService: EtfsService) {}

  // TODO: Migrer les routes depuis routes/etfs de l'ancienne app
  // Les routes ici seront accessibles via /etf/* (sans /api)
}
