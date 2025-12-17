import { getAddress } from 'ethers';

/**
 * Normalize Ethereum address to EIP-55 checksummed format
 * @param address - Ethereum address to normalize
 * @returns Normalized checksummed address
 * @throws Error if address is invalid
 */
export function normalizeEthAddress(address: string): string {
  try {
    return getAddress(address);
  } catch (e) {
    throw new Error('Invalid Ethereum address');
  }
}

