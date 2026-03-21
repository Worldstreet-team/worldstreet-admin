// Chain IDs (CAIP-2)
export const CHAINS = {
  ETHEREUM: {
    name: 'ethereum',
    caip2: 'eip155:1',
    chainId: 1,
    type: 'evm',
  },
  ARBITRUM: {
    name: 'arbitrum',
    caip2: 'eip155:42161',
    chainId: 42161,
    type: 'evm',
  },
  SOLANA: {
    name: 'solana',
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    chainId: null,
    type: 'solana',
  },
  TRON: {
    name: 'tron',
    caip2: 'tron:0x2b6653dc',
    chainId: null,
    type: 'tron',
  },
};

// Token contract addresses
export const TOKENS = {
  USDC: {
    ethereum: process.env.USDC_ETH_CONTRACT || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    arbitrum: process.env.USDC_ARB_CONTRACT || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    solana: process.env.USDC_SOL_CONTRACT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    tron: process.env.USDC_TRON_CONTRACT || 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
    decimals: 6,
  },
  USDT: {
    ethereum: process.env.USDT_ETH_CONTRACT || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    arbitrum: process.env.USDT_ARB_CONTRACT || '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    solana: process.env.USDT_SOL_CONTRACT || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    tron: process.env.USDT_TRON_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
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
  FEES: 'fees',
};

// Destination wallet types
export const WALLET_TYPE = {
  SPOT: 'spot',
  FUTURES: 'futures',
};

// Valid chain names
export const VALID_CHAINS = ['ethereum', 'arbitrum', 'solana', 'tron'];
export const VALID_TOKENS = ['USDC', 'USDT'];
export const VALID_PURPOSES = ['receive', 'disburse', 'fees'];
export const VALID_WALLET_TYPES = ['spot', 'futures'];

// Transaction types
export const TX_TYPE = {
  DISBURSEMENT: 'disbursement',
  MANUAL_SEND: 'manual-send',
  WITHDRAWAL: 'withdrawal',
};

// Chain type helpers
export const EVM_CHAINS = ['ethereum', 'arbitrum'];
export const SOLANA_CHAINS = ['solana'];
export const TRON_CHAINS = ['tron'];
export const isEvmChain = (chain) => EVM_CHAINS.includes(chain);
export const isSolanaChain = (chain) => SOLANA_CHAINS.includes(chain);
export const isTronChain = (chain) => TRON_CHAINS.includes(chain);
