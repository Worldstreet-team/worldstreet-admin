import { ethers } from 'ethers';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import config from '../config/index.js';
import { TOKENS, ERC20_TRANSFER_ABI, isEvmChain, isSolanaChain } from '../utils/constants.js';

const evmProviders = {
  ethereum: new ethers.JsonRpcProvider(config.ethereumRpcUrl),
  arbitrum: new ethers.JsonRpcProvider(config.arbitrumRpcUrl),
};

const solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed');

// ── EVM helpers ──────────────────────────────────────────────

const getEvmNativeBalance = async (chain, address) => {
  const provider = evmProviders[chain];
  if (!provider) throw new Error(`No provider for chain: ${chain}`);
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
};

const getEvmTokenBalance = async (chain, token, address) => {
  const provider = evmProviders[chain];
  if (!provider) throw new Error(`No provider for chain: ${chain}`);

  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Unknown token: ${token}`);

  const contractAddress = tokenInfo[chain];
  if (!contractAddress) throw new Error(`Token ${token} not available on ${chain}`);

  const contract = new ethers.Contract(contractAddress, ERC20_TRANSFER_ABI, provider);
  const balance = await contract.balanceOf(address);
  return ethers.formatUnits(balance, tokenInfo.decimals);
};

// ── Solana helpers ───────────────────────────────────────────

const getSolNativeBalance = async (address) => {
  const pubkey = new PublicKey(address);
  const balance = await solanaConnection.getBalance(pubkey);
  return (balance / LAMPORTS_PER_SOL).toString();
};

const getSplTokenBalance = async (address, token) => {
  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Unknown token: ${token}`);

  const mintAddress = tokenInfo.solana;
  if (!mintAddress) throw new Error(`Token ${token} not available on solana`);

  const ownerPubkey = new PublicKey(address);
  const mintPubkey = new PublicKey(mintAddress);

  try {
    const ata = await getAssociatedTokenAddress(mintPubkey, ownerPubkey);
    const account = await getAccount(solanaConnection, ata);
    const raw = Number(account.amount);
    return (raw / Math.pow(10, tokenInfo.decimals)).toString();
  } catch {
    // Account doesn't exist yet → balance is 0
    return '0';
  }
};

// ── Public API ───────────────────────────────────────────────

export const getNativeBalance = async (chain, address) => {
  if (isSolanaChain(chain)) return getSolNativeBalance(address);
  return getEvmNativeBalance(chain, address);
};

export const getTokenBalance = async (chain, token, address) => {
  if (isSolanaChain(chain)) return getSplTokenBalance(address, token);
  return getEvmTokenBalance(chain, token, address);
};

export const getWalletBalances = async (chain, address, tokens = ['USDC', 'USDT']) => {
  const balances = {
    native: await getNativeBalance(chain, address),
  };

  for (const token of tokens) {
    try {
      balances[token] = await getTokenBalance(chain, token, address);
    } catch {
      balances[token] = '0';
    }
  }

  return balances;
};
