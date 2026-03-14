import { ethers } from 'ethers';
import config from '../config/index.js';
import { TOKENS, ERC20_TRANSFER_ABI } from '../utils/constants.js';

const providers = {
  ethereum: new ethers.JsonRpcProvider(config.ethereumRpcUrl),
  arbitrum: new ethers.JsonRpcProvider(config.arbitrumRpcUrl),
};

/**
 * Get the native (ETH) balance of an address on a chain.
 */
export const getNativeBalance = async (chain, address) => {
  const provider = providers[chain];
  if (!provider) throw new Error(`No provider for chain: ${chain}`);
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
};

/**
 * Get the ERC-20 token balance of an address on a chain.
 */
export const getTokenBalance = async (chain, token, address) => {
  const provider = providers[chain];
  if (!provider) throw new Error(`No provider for chain: ${chain}`);

  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Unknown token: ${token}`);

  const contractAddress = tokenInfo[chain];
  if (!contractAddress) throw new Error(`Token ${token} not available on ${chain}`);

  const contract = new ethers.Contract(contractAddress, ERC20_TRANSFER_ABI, provider);
  const balance = await contract.balanceOf(address);
  return ethers.formatUnits(balance, tokenInfo.decimals);
};

/**
 * Get all balances (native + tokens) for a wallet.
 */
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
