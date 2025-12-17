export enum ChainId {
  MAINNET = 1,
  ARBITRUM = 42161,
}

export const GET_LOGS_BLOCKS = {
  [ChainId.MAINNET]: 1000n,
  [ChainId.ARBITRUM]: 1000n,
};
