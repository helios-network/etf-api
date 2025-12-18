import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, type PublicClient } from 'viem';
import { mainnet, arbitrum } from 'viem/chains';
import { ChainId } from '../../config/web3';
import { RpcRateLimitService } from '../rpc-rate-limit/rpc-rate-limit.service';
import { RpcRotationService } from '../rpc-rate-limit/rpc-rotation.service';
import { createTransportWithSpecificRpc } from '../rpc-rate-limit/transport-wrapper';

/**
 * Service centralisé pour la gestion des clients RPC
 * Gère automatiquement :
 * - La création de clients à la demande
 * - Le rate limiting
 * - La détection d'erreurs
 * - La rotation automatique de RPC
 * - Le reset du rate limit lors des changements de RPC
 */
@Injectable()
export class RpcClientService {
  private readonly logger = new Logger(RpcClientService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly rpcRateLimitService: RpcRateLimitService,
    private readonly rpcRotationService: RpcRotationService,
  ) {}

  /**
   * Crée un nouveau client RPC avec le meilleur RPC disponible pour la chaîne
   * Vérifie le rate limit avant de créer le client
   */
  private async createClient(chainId: ChainId): Promise<PublicClient> {
    // Vérifier le rate limit global
    const rateLimitResult = await this.rpcRateLimitService.checkRateLimit(chainId);
    
    if (!rateLimitResult.allowed && rateLimitResult.waitTime) {
      // Rate limit global atteint - essayer de changer de RPC
      const allRpcUrls = this.rpcRotationService.getRpcUrls(chainId);
      if (allRpcUrls.length > 1) {
        // Trouver un autre RPC disponible
        const currentRpc = this.rpcRotationService.getBestRpc(chainId);
        const alternativeRpc = allRpcUrls.find(
          (url) => url !== currentRpc && this.rpcRotationService.isRpcHealthy(url, chainId),
        );
        
        if (alternativeRpc) {
          this.logger.log(
            `Global rate limit reached for chain ${chainId}. Rotating RPC: ${currentRpc} -> ${alternativeRpc}`,
          );
          // Reset le rate limit lors du changement de RPC
          await this.resetRateLimit(chainId);
          return this.createClientWithRpc(chainId, alternativeRpc);
        }
      }
      
      // Pas d'alternative disponible, attendre
      this.logger.debug(
        `Global rate limit reached for chain ${chainId}, waiting ${rateLimitResult.waitTime}ms`,
      );
      await this.sleep(rateLimitResult.waitTime);
    }

    // Obtenir le meilleur RPC disponible
    const rpcUrl = this.rpcRotationService.getBestRpc(chainId);
    if (!rpcUrl) {
      throw new Error(`No RPC available for chain ${chainId}`);
    }

    return this.createClientWithRpc(chainId, rpcUrl);
  }

  /**
   * Crée un client avec un RPC spécifique
   */
  private createClientWithRpc(chainId: ChainId, rpcUrl: string): PublicClient {
    const rpcConfig = this.configService.get<any>('rpc');
    const retryConfig = rpcConfig?.retry || {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 300000,
    };

    const chain = chainId === ChainId.MAINNET ? mainnet : arbitrum;
    return createPublicClient({
      chain,
      transport: createTransportWithSpecificRpc(rpcUrl, retryConfig),
    });
  }

  /**
   * Détecte si une erreur nécessite un failover (changement de RPC)
   */
  private requiresFailover(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const errorObj = error as any;
    
    // Erreurs HTTP qui nécessitent un failover
    if (
      errorObj.status === 429 ||
      errorObj.statusCode === 429 ||
      errorObj.status === 402 ||
      errorObj.statusCode === 402 ||
      errorObj.status === 401 ||
      errorObj.statusCode === 401 ||
      errorObj.status === 403 ||
      errorObj.statusCode === 403
    ) {
      return true;
    }

    // Vérifier dans les messages d'erreur
    const textFields = [
      errorObj.message,
      errorObj.cause?.message,
      errorObj.details,
      errorObj.Details,
      errorObj.shortMessage,
      errorObj.reason,
      JSON.stringify(errorObj),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (
      textFields.includes('429') ||
      textFields.includes('402') ||
      textFields.includes('401') ||
      textFields.includes('403') ||
      textFields.includes('rate limit') ||
      textFields.includes('too many requests') ||
      textFields.includes('payment required') ||
      textFields.includes('unauthorized') ||
      textFields.includes('authenticate') ||
      textFields.includes('api key') ||
      textFields.includes('authentication required')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Obtient l'URL RPC utilisée par un client
   */
  private getClientRpcUrl(client: PublicClient): string | null {
    try {
      const transport = (client.transport as any);
      return transport?.url || null;
    } catch {
      return null;
    }
  }

  /**
   * Reset le rate limit pour une chaîne donnée
   */
  private async resetRateLimit(chainId: ChainId): Promise<void> {
    await this.rpcRateLimitService.resetRateLimit(chainId);
  }

  /**
   * Met à jour le rate limit après un appel réussi
   * (Le rate limit est déjà incrémenté dans checkRateLimit, mais on peut logger ici)
   */
  private async updateRateLimitAfterSuccess(chainId: ChainId, rpcUrl: string): Promise<void> {
    // Le rate limit est géré automatiquement par RpcRateLimitService
    // On peut juste logger ou faire d'autres actions si nécessaire
    this.rpcRotationService.recordSuccess(rpcUrl, chainId);
  }

  /**
   * Exécute une fonction avec un client RPC
   * Gère automatiquement :
   * - La création du client
   * - Le rate limiting
   * - La détection d'erreurs
   * - Les retries avec rotation de RPC
   * 
   * @param chainId La chaîne pour laquelle exécuter l'appel
   * @param fn La fonction à exécuter avec le client
   * @returns Le résultat de la fonction
   */
  async execute<T>(
    chainId: ChainId,
    fn: (client: PublicClient) => Promise<T>,
  ): Promise<T> {
    const rpcConfig = this.configService.get<any>('rpc');
    const retryConfig = rpcConfig?.retry || {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 300000,
    };

    const maxRetries = retryConfig.maxRetries || 5;
    const allRpcUrls = this.rpcRotationService.getRpcUrls(chainId);
    const maxFailoverAttempts = Math.max(maxRetries, allRpcUrls.length);
    
    let lastError: unknown;
    const attemptedRpcUrls = new Set<string>();

    for (let attempt = 0; attempt < maxFailoverAttempts; attempt++) {
      try {
        // Créer un nouveau client à chaque tentative
        const client = await this.createClient(chainId);
        const rpcUrl = this.getClientRpcUrl(client);
        
        if (rpcUrl) {
          attemptedRpcUrls.add(rpcUrl);
        }

        // Exécuter la fonction
        const result = await fn(client);

        // Succès - mettre à jour le rate limit et retourner le résultat
        if (rpcUrl) {
          await this.updateRateLimitAfterSuccess(chainId, rpcUrl);
        }

        if (attempt > 0) {
          this.logger.log(
            `RPC call succeeded on chain ${chainId} after ${attempt} retry(ies) using ${rpcUrl || 'unknown RPC'}`,
          );
        }

        return result;
      } catch (error: unknown) {
        lastError = error;
        const rpcUrl = attemptedRpcUrls.size > 0 
          ? Array.from(attemptedRpcUrls).pop() || null
          : null;

        // Vérifier si l'erreur nécessite un failover
        if (this.requiresFailover(error)) {
          if (rpcUrl) {
            this.rpcRotationService.recordRateLimit(rpcUrl, chainId);
            this.logger.warn(
              `Rate limit error detected on RPC ${rpcUrl} for chain ${chainId}. Marking as rate-limited.`,
            );
          }

          // Si on a encore des RPCs à essayer
          if (attempt < maxFailoverAttempts - 1) {
            const remainingRpcUrls = allRpcUrls.filter(
              (url) => !attemptedRpcUrls.has(url) && this.rpcRotationService.isRpcHealthy(url, chainId),
            );

            if (remainingRpcUrls.length > 0) {
              // Reset le rate limit lors du changement de RPC
              await this.resetRateLimit(chainId);
              
              this.logger.debug(
                `Retrying with different RPC for chain ${chainId} (attempt ${attempt + 1}/${maxFailoverAttempts})`,
              );
              
              // Attendre un peu avant de retry (backoff exponentiel)
              const delay = Math.min(
                retryConfig.baseDelay * Math.pow(2, attempt),
                retryConfig.maxDelay,
              );
              await this.sleep(delay);
              
              continue;
            }
          }

          // Plus de RPCs disponibles ou max retries atteint
          this.logger.error(
            `All RPC endpoints exhausted for chain ${chainId} after ${attempt + 1} attempt(s)`,
          );
          throw error;
        } else {
          // Erreur qui ne nécessite pas de failover
          if (rpcUrl) {
            this.rpcRotationService.recordError(rpcUrl, chainId, error as Error);
          }
          
          // Si c'est la dernière tentative, throw l'erreur
          if (attempt === maxFailoverAttempts - 1) {
            throw error;
          }

          // Sinon, retry avec backoff
          const delay = Math.min(
            retryConfig.baseDelay * Math.pow(2, attempt),
            retryConfig.maxDelay,
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error(`Failed to execute RPC call for chain ${chainId}`);
  }

  /**
   * Utilitaire pour attendre un certain temps
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

