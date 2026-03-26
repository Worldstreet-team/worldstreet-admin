import { ethers } from 'ethers';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { TronWeb } from 'tronweb';
import config from '../config/index.js';
import { TOKENS, ERC20_TRANSFER_ABI, isEvmChain, isSolanaChain, isTronChain } from '../utils/constants.js';
import { getNativeCoinPrice, toUsdValue } from './priceService.js';

const evmProviders = {
  ethereum: new ethers.JsonRpcProvider(config.ethereumRpcUrl),
  arbitrum: new ethers.JsonRpcProvider(config.arbitrumRpcUrl),
};

const solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed');

const tronWeb = new TronWeb({
  fullHost: config.tronRpcUrl,
  headers: config.tronApiKey ? { 'TRON-PRO-API-KEY': config.tronApiKey } : {},
});

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

// ── Tron helpers ─────────────────────────────────────────────

const SUN_PER_TRX = 1_000_000;

const getTronNativeBalance = async (address) => {
  const balanceSun = await tronWeb.trx.getBalance(address);
  // TronWeb returns 0 both for an empty wallet AND for a failed/rate-limited call.
  // Check if the result is a valid number before trusting it.
  if (typeof balanceSun !== 'number') {
    throw new Error(`[Balance] Unexpected TRX balance response for ${address}: ${JSON.stringify(balanceSun)}`);
  }
  return (balanceSun / SUN_PER_TRX).toString();
};

const getTrc20TokenBalance = async (address, token) => {
  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Unknown token: ${token}`);

  const contractAddress = tokenInfo.tron;
  if (!contractAddress) throw new Error(`Token ${token} not available on tron`);

  try {
    // Use TronGrid HTTP API — works with Alchemy and TronGrid endpoints
    const url = `${config.tronGridUrl}/v1/accounts/${address}`;
    const headers = config.tronApiKey ? { 'TRON-PRO-API-KEY': config.tronApiKey } : {};
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`[Balance] TronGrid account API error ${response.status} for ${address}`);
    }

    const body = await response.json();
    const trc20Balances = body.data?.[0]?.trc20 || [];

    // trc20 is an array of objects like [{ "TR7NHq...": "1000000" }, ...]
    for (const entry of trc20Balances) {
      const rawBalance = entry[contractAddress];
      if (rawBalance !== undefined) {
        return (Number(rawBalance) / Math.pow(10, tokenInfo.decimals)).toString();
      }
    }

    return '0';
  } catch (err) {
    console.error(`[Balance] Error fetching TRC-20 balance for ${token}:`, err.message);
    return '0';
  }
};

// ── Public API ───────────────────────────────────────────────

export const getNativeBalance = async (chain, address) => {
  if (isTronChain(chain)) return getTronNativeBalance(address);
  if (isSolanaChain(chain)) return getSolNativeBalance(address);
  return getEvmNativeBalance(chain, address);
};

export const getTokenBalance = async (chain, token, address) => {
  if (isTronChain(chain)) return getTrc20TokenBalance(address, token);
  if (isSolanaChain(chain)) return getSplTokenBalance(address, token);
  return getEvmTokenBalance(chain, token, address);
};

export const getWalletBalances = async (chain, address, tokens = ['USDC', 'USDT'], { includeFiatValues = false } = {}) => {
  const nativeBalance = await getNativeBalance(chain, address);
  const balances = {
    native: nativeBalance,
  };

  if (includeFiatValues) {
    const price = await getNativeCoinPrice(chain);
    balances.nativeUsd = toUsdValue(nativeBalance, price);
    balances.nativeCoinPrice = price;
  }

  for (const token of tokens) {
    try {
      balances[token] = await getTokenBalance(chain, token, address);
    } catch {
      balances[token] = '0';
    }
  }

  return balances;
};
