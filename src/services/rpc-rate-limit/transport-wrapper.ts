import { Logger } from '@nestjs/common';
import { http, type HttpTransport } from 'viem';
import { ChainId } from '../../config/web3';
import { RpcRetryConfig } from './interfaces';
import { RpcRotationService } from './rpc-rotation.service';

const logger = new Logger('RpcTransportWrapper');

function requiresFailover(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorObj = error as any;
  
  if (errorObj.status === 429 || errorObj.statusCode === 429 ||
      errorObj.status === 402 || errorObj.statusCode === 402 ||
      errorObj.status === 401 || errorObj.statusCode === 401 ||
      errorObj.status === 403 || errorObj.statusCode === 403) {
    return true;
  }

  const textFields = [
    errorObj.message,
    errorObj.cause?.message,
    errorObj.details,
    errorObj.Details,
    errorObj.shortMessage,
    errorObj.reason,
    JSON.stringify(errorObj),
  ].filter(Boolean).join(' ').toLowerCase();

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

function createRotatingFetch(
  chainId: ChainId,
  rotationService: RpcRotationService,
  baseUrl: string,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const maxFailoverAttempts = rotationService.getRpcUrls(chainId).length;
    const attemptedUrls = new Set<string>();
    let lastError: unknown;

    for (let attempt = 0; attempt < maxFailoverAttempts; attempt++) {
      // Trouver le meilleur RPC en excluant ceux déjà tentés
      let selectedUrl: string | null = null;
      const allUrls = rotationService.getRpcUrls(chainId);
      
      // Essayer de trouver un RPC healthy qui n'a pas encore été tenté
      for (const url of allUrls) {
        if (!attemptedUrls.has(url)) {
          const state = rotationService.getHealthState(url, chainId);
          if (state && rotationService.isRpcHealthy(url, chainId)) {
            selectedUrl = url;
            break;
          }
        }
      }
      
      // Si aucun RPC healthy non tenté trouvé, utiliser getBestRpc en excluant les URLs tentées une par une
      if (!selectedUrl) {
        const excludeUrls = Array.from(attemptedUrls);
        for (const excludeUrl of excludeUrls) {
          selectedUrl = rotationService.getBestRpc(chainId, excludeUrl);
          if (selectedUrl && !attemptedUrls.has(selectedUrl)) {
            break;
          }
        }
        // Dernier recours: utiliser getBestRpc sans exclusion
        if (!selectedUrl || attemptedUrls.has(selectedUrl)) {
          selectedUrl = rotationService.getBestRpc(chainId);
        }
      }
      
      if (!selectedUrl) {
        throw new Error(`No RPC available for chain ${chainId}`);
      }

      attemptedUrls.add(selectedUrl);
      
      if (attempt > 0) {
        logger.debug(
          `RPC rotation: using ${selectedUrl} for chain ${chainId} (attempt ${attempt + 1}/${maxFailoverAttempts})`,
        );
      }

      try {
        let requestUrl: string;
        // Pour les requêtes JSON-RPC, utiliser directement l'URL du RPC sélectionné
        // viem passe l'URL complète, mais on veut toujours utiliser le RPC sélectionné
        const allRpcUrls = rotationService.getRpcUrls(chainId);
        
        // Fonction helper pour remplacer l'URL du RPC
        const replaceRpcUrl = (url: string): string => {
          // Chercher si l'URL contient l'un des RPCs configurés
          for (const rpcUrl of allRpcUrls) {
            if (url.includes(rpcUrl)) {
              return url.replace(rpcUrl, selectedUrl);
            }
          }
          // Si baseUrl est présent, le remplacer
          if (url.includes(baseUrl)) {
            return url.replace(baseUrl, selectedUrl);
          }
          // Sinon, utiliser directement selectedUrl (pour les requêtes JSON-RPC)
          return selectedUrl;
        };
        
        if (typeof input === 'string') {
          requestUrl = replaceRpcUrl(input);
        } else if (input instanceof URL) {
          requestUrl = replaceRpcUrl(input.href);
        } else {
          // Request object
          requestUrl = replaceRpcUrl(input.url);
        }
        
        // Logger seulement si on a vraiment changé l'URL
        const originalUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (requestUrl !== originalUrl) {
          logger.debug(
            `RPC URL replaced for chain ${chainId}: ${originalUrl.substring(0, 50)}... -> ${selectedUrl}`,
          );
        }

        const requestInit: RequestInit = {
          ...init,
          method: init?.method || (input instanceof Request ? input.method : 'POST'),
          headers: {
            'Content-Type': 'application/json',
            ...(input instanceof Request ? Object.fromEntries(input.headers.entries()) : {}),
            ...init?.headers,
          },
          body: init?.body || (input instanceof Request ? input.body : undefined),
        };

        const response = await fetch(requestUrl, requestInit);

        if (response.status === 429 || response.status === 402 || 
            response.status === 401 || response.status === 403) {
          rotationService.recordRateLimit(selectedUrl, chainId);
          logger.warn(
            `HTTP ${response.status} received from RPC ${selectedUrl} on chain ${chainId}. Marking as rate-limited and rotating.`,
          );
          
          if (attempt < maxFailoverAttempts - 1) {
            const errorMsg = response.status === 429 
              ? `Rate limited on ${selectedUrl}`
              : response.status === 402
              ? `Payment required on ${selectedUrl}`
              : `Unauthorized on ${selectedUrl}`;
            lastError = new Error(errorMsg);
            logger.debug(
              `Attempting RPC rotation for chain ${chainId} (attempt ${attempt + 1}/${maxFailoverAttempts})`,
            );
            continue;
          }
          
          const errorMsg = response.status === 429
            ? `Rate limited on all RPC endpoints for chain ${chainId}`
            : response.status === 402
            ? `Payment required on all RPC endpoints for chain ${chainId}`
            : `Unauthorized on all RPC endpoints for chain ${chainId}`;
          throw new Error(errorMsg);
        }

        const responseText = await response.text().catch(() => '');
        if (responseText) {
          try {
            const responseJson = JSON.parse(responseText);
            if (responseJson.error) {
              const errorMessage = JSON.stringify(responseJson.error).toLowerCase();
              if (
                errorMessage.includes('unauthorized') ||
                errorMessage.includes('authenticate') ||
                errorMessage.includes('api key') ||
                errorMessage.includes('401') ||
                errorMessage.includes('403') ||
                errorMessage.includes('429') ||
                errorMessage.includes('402')
              ) {
                rotationService.recordRateLimit(selectedUrl, chainId);
                logger.warn(
                  `Rate limit error detected in RPC response from ${selectedUrl} on chain ${chainId}. Marking as rate-limited and rotating.`,
                );
                
                if (attempt < maxFailoverAttempts - 1) {
                  lastError = new Error(`RPC error on ${selectedUrl}: ${responseJson.error.message || 'Unknown error'}`);
                  logger.debug(
                    `Attempting RPC rotation for chain ${chainId} (attempt ${attempt + 1}/${maxFailoverAttempts})`,
                  );
                  continue;
                }
                
                throw new Error(`RPC error on all endpoints for chain ${chainId}: ${responseJson.error.message || 'Unknown error'}`);
              }
            }
          } catch { }
        }

        if (response.ok) {
          rotationService.recordSuccess(selectedUrl, chainId);
          if (attempt > 0) {
            logger.log(
              `RPC request succeeded on chain ${chainId} using ${selectedUrl} after ${attempt} rotation(s)`,
            );
          }
          return new Response(responseText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }

        const error = new Error(`HTTP ${response.status}: ${responseText || 'Unknown error'}`);
        (error as any).status = response.status;
        rotationService.recordError(selectedUrl, chainId, error);
        throw error;
      } catch (error: unknown) {
        lastError = error;

        if (requiresFailover(error)) {
          rotationService.recordRateLimit(selectedUrl, chainId);
          logger.warn(
            `Rate limit error detected from RPC ${selectedUrl} on chain ${chainId}. Marking as rate-limited and rotating.`,
          );
          
          if (attempt < maxFailoverAttempts - 1) {
            logger.debug(
              `Attempting RPC rotation for chain ${chainId} (attempt ${attempt + 1}/${maxFailoverAttempts})`,
            );
            continue;
          }
        } else {
          rotationService.recordError(selectedUrl, chainId, error as Error);
        }

        if (attempt === maxFailoverAttempts - 1) {
          throw error;
        }
      }
    }

    throw lastError || new Error(`All RPC endpoints exhausted for chain ${chainId}`);
  };
}

export function createRotatingTransport(
  chainId: ChainId,
  rotationService: RpcRotationService,
  retryConfig: RpcRetryConfig,
): HttpTransport {
  const baseUrl = rotationService.getBestRpc(chainId) || rotationService.getRpcUrls(chainId)[0];
  
  if (!baseUrl) {
    throw new Error(`No RPC URLs configured for chain ${chainId}`);
  }

  return http(baseUrl, {
    retryCount: 0,
    fetchFn: createRotatingFetch(chainId, rotationService, baseUrl),
  });
}

export function createRateLimitedTransport(
  url: string,
  retryConfig: RpcRetryConfig,
): HttpTransport {
  return http(url, {
    retryCount: retryConfig.maxRetries,
    retryDelay: Math.max(100, Math.floor(retryConfig.baseDelay / 2)),
  });
}

/**
 * Crée un transport avec un RPC spécifique (sans rotation)
 * Utilisé pour créer un client avec un RPC particulier lors de la rotation
 */
export function createTransportWithSpecificRpc(
  url: string,
  retryConfig: RpcRetryConfig,
): HttpTransport {
  return http(url, {
    retryCount: retryConfig.maxRetries,
    retryDelay: Math.max(100, Math.floor(retryConfig.baseDelay / 2)),
  });
}
