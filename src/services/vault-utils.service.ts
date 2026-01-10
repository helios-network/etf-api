import { Injectable, Logger } from '@nestjs/common';
import {
  parseAbi,
  encodeFunctionData,
  decodeFunctionResult,
  erc20Abi,
} from 'viem';
import { RpcClientService } from './rpc-client/rpc-client.service';
import { ChainId } from '../config/web3';

@Injectable()
export class VaultUtilsService {
  private readonly logger = new Logger(VaultUtilsService.name);

  constructor(
    private readonly rpcClientService: RpcClientService,
  ) {}
  /**
   * Fetch vault configuration from blockchain
   */
  async fetchVaultConfig(
    vaultAddress: `0x${string}`,
    shareToken: `0x${string}`,
    chainId: ChainId,
  ): Promise<{
    factory: string;
    owner: string;
    pricer: string;
    pricingMode: string;
    depositToken: string;
    depositFeed: string;
    shareToken: string;
    assets: Array<{
      token: string;
      targetWeightBps: number;
      v2Path: string[];
      v3Path: string;
      v3PoolFee: number;
    }>;
    imbalanceThresholdBps: bigint;
    depositSymbol: string;
    depositDecimals: number;
    shareDecimals: number;
  }> {
    const vaultAbi = parseAbi([
      'function factory() view returns (address)',
      'function owner() view returns (address)',
      'function depositToken() view returns (address)',
      'function depositFeed() view returns (address)',
      'function assetCount() view returns (uint256)',
      'function imbalanceThresholdBps() view returns (uint256)',
      'function pricer() view returns (address)',
    ]);

    const [
      factory,
      owner,
      depositToken,
      depositFeed,
      assetsLength,
      imbalanceThresholdBps,
      pricer,
    ] = await Promise.all([
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'factory',
        }),
      ),
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'owner',
        }),
      ),
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'depositToken',
        }),
      ),
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'depositFeed',
        }),
      ),
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'assetCount',
        }),
      ),
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'imbalanceThresholdBps',
        }),
      ),
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'pricer',
        }),
      ),
    ]);

    const rawPricerResults = await this.rpcClientService.execute(chainId, (client) =>
      client.call({
        to: pricer,
        data: encodeFunctionData({
          abi: [
            {
              type: 'function',
              name: 'getAssets',
              inputs: [],
              outputs: [
                {
                  type: 'tuple[]',
                  components: [
                    { name: 'token', type: 'address' },
                    { name: 'feed', type: 'address' },
                    { name: 'v2Path', type: 'address[]' },
                    { name: 'v3Path', type: 'bytes' },
                    { name: 'v3PoolFee', type: 'uint24' },
                  ],
                },
              ],
              stateMutability: 'view',
            },
          ],
          functionName: 'getAssets',
          args: [],
        }),
      }),
    );
  
    if (!rawPricerResults.data) {
      throw new Error('No data returned');
    }
  
    const assetsPricerResults = decodeFunctionResult({
      abi: [
        {
          type: 'function',
          name: 'getAssets',
          inputs: [],
          outputs: [
            {
              type: 'tuple[]',
              components: [
                { name: 'token', type: 'address' },
                { name: 'feed', type: 'address' },
                { name: 'v2Path', type: 'address[]' },
                { name: 'v3Path', type: 'bytes' },
                { name: 'v3PoolFee', type: 'uint24' },
              ],
            },
          ],
          stateMutability: 'view',
        },
      ],
      data: rawPricerResults.data,
    });

    const raw = await this.rpcClientService.execute(chainId, (client) =>
      client.call({
        to: vaultAddress,
        data: encodeFunctionData({
          abi: [
            {
              type: 'function',
              name: 'getAssets',
              inputs: [],
              outputs: [
                {
                  type: 'tuple[]',
                  components: [
                    { name: 'token', type: 'address' },
                    { name: 'targetWeightBps', type: 'uint256' },
                  ],
                },
              ],
              stateMutability: 'view',
            },
          ],
          functionName: 'getAssets',
          args: [],
        }),
      }),
    );

    if (!raw.data) {
      throw new Error('No data returned');
    }

    const assetsResults = decodeFunctionResult({
      abi: [
        {
          type: 'function',
          name: 'getAssets',
          inputs: [],
          outputs: [
            {
              type: 'tuple[]',
              components: [
                { name: 'token', type: 'address' },
                { name: 'targetWeightBps', type: 'uint256' },
              ],
            },
          ],
          stateMutability: 'view',
        },
      ],
      data: raw.data,
    });

    const pricingMode = await this.rpcClientService.execute(chainId, (client) =>
      client.readContract({
        address: pricer,
        abi: parseAbi(['function pricingMode() view returns (uint256)']),
        functionName: 'pricingMode',
      }),
    );

    const pricingModeMap = new Map<number, string>([
      [0, 'V2_PLUS_FEED'],
      [1, 'V3_PLUS_FEED'],
      [2, 'V2_PLUS_V2'],
      [3, 'V3_PLUS_V3']
    ]);

    const pricingModeString = pricingModeMap.get(Number(pricingMode)) || '';

    let assets: any[] = [];
    for (let i = 0; i < assetsResults.length; i++) {
      const asset = assetsResults[i];
      const assetPricer = assetsPricerResults[i];

      assets.push({
        token: asset.token as string,
        feed: (assetPricer.feed as string) || '',
        targetWeightBps: Number(asset.targetWeightBps),
        v2Path: (assetPricer.v2Path as string[]) || [],
        v3Path: (assetPricer.v3Path as string) || '',
        v3PoolFee: Number(assetPricer.v3PoolFee),
      });
    }

    // const assets = assetsResults.map((asset: any) => ({
    //   token: asset.token as string,
    //   feed: (asset.feed as string) || '',
    //   targetWeightBps: Number(asset.targetWeightBps),
    //   depositPath: (asset.depositPath as string[]) || [],
    //   withdrawPath: (asset.withdrawPath as string[]) || [],
    // }));

    // Fetch symbol and decimals for each asset token
    const assetDetailsPromises = assets.map(async (asset) => {
      try {
        const [symbol, decimals] = await Promise.all([
          this.rpcClientService.execute(chainId, (client) =>
            client.readContract({
              address: asset.token as `0x${string}`,
              abi: erc20Abi,
              functionName: 'symbol',
            }),
          ),
          this.rpcClientService.execute(chainId, (client) =>
            client.readContract({
              address: asset.token as `0x${string}`,
              abi: erc20Abi,
              functionName: 'decimals',
            }),
          ),
        ]);
        return {
          ...asset,
          symbol: symbol as string,
          decimals: Number(decimals),
        };
      } catch (error) {
        this.logger.error(
          `Error fetching token details for ${asset.token}:`,
          error,
        );
        return asset;
      }
    });

    const assetsWithDetails = await Promise.all(assetDetailsPromises);

    // Fetch symbol and decimals for depositToken
    let depositSymbol = '';
    let depositDecimals = 0;
    try {
      const [symbol, decimals] = await Promise.all([
        this.rpcClientService.execute(chainId, (client) =>
          client.readContract({
            address: depositToken as `0x${string}`,
            abi: erc20Abi,
            functionName: 'symbol',
          }),
        ),
        this.rpcClientService.execute(chainId, (client) =>
          client.readContract({
            address: depositToken as `0x${string}`,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
        ),
      ]);
      depositSymbol = symbol as string;
      depositDecimals = Number(decimals);
    } catch (error) {
      this.logger.error(
        `Error fetching depositToken details for ${depositToken}:`,
        error,
      );
    }

    // Fetch decimals for shareToken
    let shareDecimals = 18; // Default to 18
    try {
      const decimals = await this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: shareToken as `0x${string}`,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
      );
      shareDecimals = Number(decimals);
    } catch (error) {
      this.logger.error(
        `Error fetching shareToken decimals for ${shareToken}:`,
        error,
      );
    }

    return {
      factory: factory as string,
      owner: owner as string,
      pricer: pricer as string,
      pricingMode: pricingModeString,
      depositToken: depositToken as string,
      depositFeed: depositFeed as string,
      shareToken: shareToken as string,
      assets: assetsWithDetails,
      imbalanceThresholdBps: imbalanceThresholdBps as bigint,
      depositSymbol,
      depositDecimals,
      shareDecimals,
    };
  }

  /**
   * Fetch only vault assets configuration (optimized version)
   * This method only fetches assets from vault (token + targetWeightBps) without pricer data
   * Use this when you already have pricer data (feed, v2Path, v3Path, v3PoolFee) and symbol/decimals
   * from ETF document to avoid redundant calls
   */
  async fetchVaultAssetsOnly(
    vaultAddress: `0x${string}`,
    chainId: ChainId,
  ): Promise<Array<{
    token: string;
    targetWeightBps: number;
  }>> {
    // Fetch assets from vault only
    const raw = await this.rpcClientService.execute(chainId, (client) =>
      client.call({
        to: vaultAddress,
        data: encodeFunctionData({
          abi: [
            {
              type: 'function',
              name: 'getAssets',
              inputs: [],
              outputs: [
                {
                  type: 'tuple[]',
                  components: [
                    { name: 'token', type: 'address' },
                    { name: 'targetWeightBps', type: 'uint256' },
                  ],
                },
              ],
              stateMutability: 'view',
            },
          ],
          functionName: 'getAssets',
          args: [],
        }),
      }),
    );

    if (!raw.data) {
      throw new Error('No data returned from vault');
    }

    const assetsResults = decodeFunctionResult({
      abi: [
        {
          type: 'function',
          name: 'getAssets',
          inputs: [],
          outputs: [
            {
              type: 'tuple[]',
              components: [
                { name: 'token', type: 'address' },
                { name: 'targetWeightBps', type: 'uint256' },
              ],
            },
          ],
          stateMutability: 'view',
        },
      ],
      data: raw.data,
    });

    return assetsResults.map((asset: any) => ({
      token: asset.token as string,
      targetWeightBps: Number(asset.targetWeightBps),
    }));
  }

  /**
   * Convert BigInt to string with decimals rounding
   */
  formatTokenAmount(
    amount: bigint | undefined,
    decimals: number,
  ): string | undefined {
    if (amount === undefined || amount === null) return undefined;
    if (decimals === 0) return amount.toString();

    const divisor = BigInt(10 ** decimals);
    const wholePart = amount / divisor;
    const fractionalPart = amount % divisor;

    if (fractionalPart === 0n) {
      return wholePart.toString();
    }

    // Convert fractional part to decimal string with leading zeros
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    // Remove trailing zeros
    const trimmedFractional = fractionalStr.replace(/0+$/, '');

    if (trimmedFractional === '') {
      return wholePart.toString();
    }

    return `${wholePart}.${trimmedFractional}`;
  }

  /**
   * Format BigInt value with 18 decimals (for USD values)
   */
  formatUSDValue(value: bigint): string {
    return this.formatTokenAmount(value, 18) ?? '0';
  }

  /**
   * Fetch portfolio value and NAV from vault contract
   */
  async fetchVaultPortfolio(
    vaultAddress: `0x${string}`,
    chainId: ChainId,
    shareDecimals?: number,
  ): Promise<{
    totalValue: string;
    valuesPerAsset: string[];
    nav: string;
  }> {
    const vaultAbi = parseAbi([
      'function getPortfolioValue() view returns (uint256 totalValue, uint256[] valuesPerAsset)',
      'function getNAV() view returns (uint256 nav)',
    ]);

    const [portfolioResult, nav] = await Promise.all([
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'getPortfolioValue',
        }),
      ),
      this.rpcClientService.execute(chainId, (client) =>
        client.readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: 'getNAV',
        }),
      ),
    ]);

    const totalValue = portfolioResult[0] as bigint;
    const valuesPerAsset = portfolioResult[1] as bigint[];

    // NAV is returned with shareDecimals, not always 18
    // Use shareDecimals if provided, otherwise default to 18
    const navDecimals = shareDecimals ?? 18;
    const navFormatted = this.formatTokenAmount(nav, navDecimals) ?? '0';

    return {
      totalValue: this.formatUSDValue(totalValue),
      valuesPerAsset: valuesPerAsset.map((value) => this.formatUSDValue(value)),
      nav: navFormatted,
    };
  }
}
