import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { RateLimitService } from './rate-limit.service';
import { RATE_LIMIT_CONSTANTS, BYPASS_RATE_LIMIT_KEY } from './rate-limit.constants';

/**
 * Décorateur pour bypasser le rate limiting sur une route spécifique
 * Utile pour les endpoints comme /health, /metrics, etc.
 *
 * @example
 * @Get('health')
 * @BypassRateLimit()
 * check() { ... }
 */
export const BypassRateLimit = () => SetMetadata(BYPASS_RATE_LIMIT_KEY, true);

/**
 * Guard de rate limiting distribué
 * Vérifie les limites via Redis et ajoute les headers standards
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();

    // Vérifier si le rate limiting est désactivé
    const rateLimitConfig = this.configService.get<{
      enabled: boolean;
      windowMs: number;
      maxRequests: number;
    }>('rateLimit');

    if (!rateLimitConfig?.enabled) {
      // Même si désactivé, on peut ajouter les headers pour transparence
      this.setHeaders(response, {
        limit: rateLimitConfig?.maxRequests || 100,
        remaining: rateLimitConfig?.maxRequests || 100,
        reset: Date.now() + (rateLimitConfig?.windowMs || 60000),
      });
      return true;
    }

    // Vérifier si la route a le décorateur @BypassRateLimit
    const handler = context.getHandler();
    const bypass = Reflect.getMetadata(BYPASS_RATE_LIMIT_KEY, handler);
    if (bypass) {
      return true;
    }

    // Extraire l'identifiant (IP pour l'instant)
    const identifier = this.rateLimitService.getIdentifier(request);

    // Vérifier la limite
    const result = await this.rateLimitService.checkLimit(
      identifier,
      rateLimitConfig.windowMs,
      rateLimitConfig.maxRequests,
    );

    // Toujours ajouter les headers (standard HTTP)
    this.setHeaders(response, result);

    // Si la limite est dépassée, lever une exception HTTP 429
    if (!result.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: RATE_LIMIT_CONSTANTS.MESSAGES.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Ajoute les headers HTTP standards pour le rate limiting
   */
  private setHeaders(
    response: FastifyReply,
    result: {
      limit: number;
      remaining: number;
      reset: number;
    },
  ): void {
    // Convertir reset de millisecondes en secondes (timestamp Unix)
    const resetSeconds = Math.ceil(result.reset / 1000);

    response.header(
      RATE_LIMIT_CONSTANTS.HEADERS.LIMIT,
      result.limit.toString(),
    );
    response.header(
      RATE_LIMIT_CONSTANTS.HEADERS.REMAINING,
      result.remaining.toString(),
    );
    response.header(
      RATE_LIMIT_CONSTANTS.HEADERS.RESET,
      resetSeconds.toString(),
    );
  }
}
