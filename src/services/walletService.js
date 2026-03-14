import privy, { authorizationPrivateKey } from '../config/privy.js';
import Wallet from '../models/Wallet.js';
import { CHAINS } from '../utils/constants.js';

const CHAIN_MAP = {
  ethereum: CHAINS.ETHEREUM,
  arbitrum: CHAINS.ARBITRUM,
};

/**
 * Create a new treasury wallet via Privy and store it locally.
 */
export const createTreasuryWallet = async ({ chain, purpose, tokens, label }) => {
  const chainInfo = CHAIN_MAP[chain];
  if (!chainInfo) throw new Error(`Unsupported chain: ${chain}`);

  // Create wallet via Privy — owned by the app's authorization key
  const privyWallet = await privy.wallets().create({
    chainType: 'ethereum',
  });

  const wallet = await Wallet.create({
    privyWalletId: privyWallet.id,
    address: privyWallet.address,
    chain,
    chainId: chainInfo.caip2,
    purpose,
    tokens,
    label: label || `${purpose}-${chain}`,
    isActive: true,
  });

  return wallet;
};

/**
 * Get all treasury wallets, optionally filtered.
 */
export const getWallets = async (filter = {}) => {
  return Wallet.find(filter).sort({ createdAt: -1 });
};

/**
 * Get a single wallet by ID.
 */
export const getWalletById = async (id) => {
  return Wallet.findById(id);
};

/**
 * Update wallet fields (label, isActive).
 */
export const updateWallet = async (id, updates) => {
  const allowed = {};
  if (updates.label !== undefined) allowed.label = updates.label;
  if (updates.isActive !== undefined) allowed.isActive = updates.isActive;
  return Wallet.findByIdAndUpdate(id, allowed, { new: true });
};

/**
 * Find an active receive wallet for a given chain.
 */
export const findReceiveWallet = async (chain) => {
  return Wallet.findOne({ chain, purpose: 'receive', isActive: true });
};

/**
 * Find an active disburse wallet for a given chain.
 */
export const findDisburseWallet = async (chain) => {
  return Wallet.findOne({ chain, purpose: 'disburse', isActive: true });
};
