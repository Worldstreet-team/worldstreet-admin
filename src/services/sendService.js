import { ethers } from 'ethers';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction as SolTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import privy, { authorizationPrivateKey } from '../config/privy.js';
import config from '../config/index.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import {
  TOKENS,
  CHAINS,
  TX_STATUS,
  TX_TYPE,
  isEvmChain,
  isSolanaChain,
} from '../utils/constants.js';

const EVM_PROVIDERS = {
  ethereum: new ethers.JsonRpcProvider(config.ethereumRpcUrl),
  arbitrum: new ethers.JsonRpcProvider(config.arbitrumRpcUrl),
};

const CHAIN_CAIP2 = {
  ethereum: CHAINS.ETHEREUM.caip2,
  arbitrum: CHAINS.ARBITRUM.caip2,
};

const solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed');

// ── EVM helpers ──────────────────────────────────────────────

const buildErc20TransferData = (toAddress, amount, decimals) => {
  const iface = new ethers.Interface([
    'function transfer(address to, uint256 amount) returns (bool)',
  ]);
  const amountWei = ethers.parseUnits(String(amount), decimals);
  return iface.encodeFunctionData('transfer', [toAddress, amountWei]);
};

const sendEvmNative = async (wallet, toAddress, amount) => {
  const caip2 = CHAIN_CAIP2[wallet.chain];
  const value = ethers.parseEther(String(amount));

  const result = await privy.wallets().ethereum().sendTransaction(
    wallet.privyWalletId,
    {
      caip2,
      params: {
        transaction: {
          to: toAddress,
          value: `0x${value.toString(16)}`,
        },
      },
      authorization_context: {
        authorization_private_keys: [authorizationPrivateKey],
      },
    },
  );
  return result;
};

const sendEvmToken = async (wallet, toAddress, token, amount) => {
  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Unknown token: ${token}`);

  const contractAddress = tokenInfo[wallet.chain];
  if (!contractAddress) throw new Error(`Token ${token} not available on ${wallet.chain}`);

  const data = buildErc20TransferData(toAddress, amount, tokenInfo.decimals);
  const caip2 = CHAIN_CAIP2[wallet.chain];

  const result = await privy.wallets().ethereum().sendTransaction(
    wallet.privyWalletId,
    {
      caip2,
      params: {
        transaction: {
          to: contractAddress,
          data,
        },
      },
      authorization_context: {
        authorization_private_keys: [authorizationPrivateKey],
      },
    },
  );
  return result;
};

// ── Solana helpers ───────────────────────────────────────────

const sendSolanaNative = async (wallet, toAddress, amount) => {
  const fromPubkey = new PublicKey(wallet.address);
  const toPubkey = new PublicKey(toAddress);
  const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);

  const tx = new SolTransaction().add(
    SystemProgram.transfer({ fromPubkey, toPubkey, lamports }),
  );
  tx.feePayer = fromPubkey;
  tx.recentBlockhash = (await solanaConnection.getLatestBlockhash()).blockhash;

  const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

  const result = await privy.wallets().solana().signAndSendTransaction(
    wallet.privyWalletId,
    {
      transaction: serialized,
      authorization_context: {
        authorization_private_keys: [authorizationPrivateKey],
      },
    },
  );
  return result;
};

const sendSplToken = async (wallet, toAddress, token, amount) => {
  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Unknown token: ${token}`);

  const mintAddress = tokenInfo.solana;
  if (!mintAddress) throw new Error(`Token ${token} not available on solana`);

  const fromPubkey = new PublicKey(wallet.address);
  const toPubkey = new PublicKey(toAddress);
  const mintPubkey = new PublicKey(mintAddress);

  const fromAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
  const toAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);

  const tx = new SolTransaction();
  tx.feePayer = fromPubkey;
  tx.recentBlockhash = (await solanaConnection.getLatestBlockhash()).blockhash;

  // Create the destination ATA if it doesn't exist
  try {
    await getAccount(solanaConnection, toAta);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(fromPubkey, toAta, toPubkey, mintPubkey),
    );
  }

  const tokenAmount = Math.round(parseFloat(amount) * Math.pow(10, tokenInfo.decimals));
  tx.add(createTransferInstruction(fromAta, toAta, fromPubkey, tokenAmount));

  const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

  const result = await privy.wallets().solana().signAndSendTransaction(
    wallet.privyWalletId,
    {
      transaction: serialized,
      authorization_context: {
        authorization_private_keys: [authorizationPrivateKey],
      },
    },
  );
  return result;
};

// ── Public API ───────────────────────────────────────────────

export const sendFromWallet = async (walletId, { toAddress, token, amount }) => {
  const wallet = await Wallet.findById(walletId);
  if (!wallet) throw new Error('Wallet not found');
  if (!wallet.isActive) throw new Error('Wallet is not active');

  let result;

  if (isEvmChain(wallet.chain)) {
    if (token === 'native') {
      result = await sendEvmNative(wallet, toAddress, amount);
    } else {
      result = await sendEvmToken(wallet, toAddress, token, amount);
    }
  } else if (isSolanaChain(wallet.chain)) {
    if (token === 'native') {
      result = await sendSolanaNative(wallet, toAddress, amount);
    } else {
      result = await sendSplToken(wallet, toAddress, token, amount);
    }
  } else {
    throw new Error(`Unsupported chain: ${wallet.chain}`);
  }

  const txHash = result.hash || result.signature || result.transaction_hash;

  const tx = await Transaction.create({
    walletId: wallet._id,
    chain: wallet.chain,
    token,
    amount: parseFloat(amount),
    toAddress,
    txHash,
    type: TX_TYPE.MANUAL_SEND,
    status: TX_STATUS.SUBMITTED,
  });

  return { tx, wallet };
};
