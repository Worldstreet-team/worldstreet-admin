// Chain IDs (CAIP-2)
export const CHAINS = {
  ETHEREUM: {
    name: 'ethereum',
    caip2: 'eip155:1',
    chainId: 1,
  },
  ARBITRUM: {
    name: 'arbitrum',
    caip2: 'eip155:42161',
    chainId: 42161,
  },
};

// Token contract addresses
export const TOKENS = {
  USDC: {
    ethereum: process.env.USDC_ETH_CONTRACT || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    arbitrum: process.env.USDC_ARB_CONTRACT || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6,
  },
  USDT: {
    ethereum: process.env.USDT_ETH_CONTRACT || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    arbitrum: process.env.USDT_ARB_CONTRACT || '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6,
  },
};

// ERC-20 transfer function signature
export const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Deposit request statuses
export const DEPOSIT_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  EXPIRED: 'expired',
  REJECTED: 'rejected',
};

// Transaction statuses
export const TX_STATUS = {
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
};

// Wallet purposes
export const WALLET_PURPOSE = {
  RECEIVE: 'receive',
  DISBURSE: 'disburse',
};

// Valid chain names
export const VALID_CHAINS = ['ethereum', 'arbitrum'];
export const VALID_TOKENS = ['USDC', 'USDT'];
export const VALID_PURPOSES = ['receive', 'disburse'];
