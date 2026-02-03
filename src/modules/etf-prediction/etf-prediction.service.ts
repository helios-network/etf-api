import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from 'src/infrastructure/cache/cache.service';
import { ETF, ETFDocument } from 'src/models';
import { normalizeEthAddress } from 'src/common/utils/eip55';

@Injectable()
export class EtfPredictionService {
  private readonly logger = new Logger(EtfPredictionService.name);

  constructor(
    @InjectModel(ETF.name)
    private etfModel: Model<ETFDocument>,
    private readonly cacheService: CacheService,
  ) {}

  async getEtfWithVault(vaultAddress: string) {
    // Build cache key with all parameters that influence the result
    const normalizedVault = normalizeEthAddress(vaultAddress);

    const cacheKey = `etf-prediction:vaultAddress=${normalizedVault}`;

    // Use cache-aside pattern with 60 seconds TTL
    return await this.cacheService.wrap(
      cacheKey,
      async () => {
        // Fetch ETF
        const etf = await this.etfModel.findOne({ vault: normalizedVault }).lean().exec();

        return {
          success: true,
          data: etf,
        };
      },
      {
        namespace: 'etf',
        ttl: 60, // 60 seconds
      },
    );
  }
}
