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
  solana: CHAINS.SOLANA.caip2,
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

const MIN_SOL_FOR_FEES = 0.005; // ~5000 lamports buffer for tx fees + rent

const ensureSolanaFundedAccount = async (address) => {
  const pubkey = new PublicKey(address);
  const balance = await solanaConnection.getBalance(pubkey);
  if (balance === 0) {
    throw new Error(
      `Solana wallet ${address} has never been funded. ` +
      `Deposit at least ${MIN_SOL_FOR_FEES} SOL to cover transaction fees before sending.`,
    );
  }
  const solBalance = balance / LAMPORTS_PER_SOL;
  if (solBalance < MIN_SOL_FOR_FEES) {
    throw new Error(
      `Solana wallet ${address} has only ${solBalance} SOL. ` +
      `At least ${MIN_SOL_FOR_FEES} SOL is needed to cover transaction fees.`,
    );
  }
};

const MAX_BLOCKHASH_RETRIES = 3;

const buildAndSendSolanaTransaction = async (wallet, buildInstructions) => {
  await ensureSolanaFundedAccount(wallet.address);
  const fromPubkey = new PublicKey(wallet.address);

  for (let attempt = 1; attempt <= MAX_BLOCKHASH_RETRIES; attempt++) {
    const tx = new SolTransaction();
    buildInstructions(tx, fromPubkey);
    tx.feePayer = fromPubkey;
    tx.recentBlockhash = (
      await solanaConnection.getLatestBlockhash('finalized')
    ).blockhash;

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    try {
      const result = await privy.wallets().solana().signAndSendTransaction(
        wallet.privyWalletId,
        {
          caip2: CHAIN_CAIP2.solana,
          transaction: serialized,
          authorization_context: {
            authorization_private_keys: [authorizationPrivateKey],
          },
        },
      );
      return result;
    } catch (err) {
      const isBlockhashError =
        err?.message?.includes('Blockhash not found') ||
        err?.body?.includes?.('Blockhash not found');
      if (isBlockhashError && attempt < MAX_BLOCKHASH_RETRIES) {
        continue;
      }
      throw err;
    }
  }
};

const sendSolanaNative = async (wallet, toAddress, amount) => {
  const toPubkey = new PublicKey(toAddress);
  const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);

  // Pre-flight: ensure enough SOL for transfer + fees
  const fromPubkey = new PublicKey(wallet.address);
  const balance = await solanaConnection.getBalance(fromPubkey);
  const needed = lamports + Math.round(MIN_SOL_FOR_FEES * LAMPORTS_PER_SOL);
  if (balance < needed) {
    throw new Error(
      `Insufficient SOL balance. Wallet has ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL ` +
      `but needs ${(needed / LAMPORTS_PER_SOL).toFixed(6)} SOL (${amount} SOL + fees).`,
    );
  }

  return buildAndSendSolanaTransaction(wallet, (tx, fp) => {
    tx.add(SystemProgram.transfer({ fromPubkey: fp, toPubkey, lamports }));
  });
};

const sendSplToken = async (wallet, toAddress, token, amount) => {
  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Unknown token: ${token}`);

  const mintAddress = tokenInfo.solana;
  if (!mintAddress) throw new Error(`Token ${token} not available on solana`);

  const toPubkey = new PublicKey(toAddress);
  const mintPubkey = new PublicKey(mintAddress);
  const fromPubkey = new PublicKey(wallet.address);

  const fromAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
  const toAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);

  const tokenAmount = Math.round(parseFloat(amount) * Math.pow(10, tokenInfo.decimals));

  // Pre-flight: ensure sender's token account exists and has enough tokens
  let senderTokenBalance;
  try {
    const fromAccount = await getAccount(solanaConnection, fromAta);
    senderTokenBalance = Number(fromAccount.amount);
  } catch {
    throw new Error(
      `Insufficient ${token} balance. Wallet ${wallet.address} has no ${token} token account. ` +
      `Deposit ${token} before sending.`,
    );
  }
  if (senderTokenBalance < tokenAmount) {
    const have = senderTokenBalance / Math.pow(10, tokenInfo.decimals);
    throw new Error(
      `Insufficient ${token} balance. Wallet has ${have} ${token} but tried to send ${amount} ${token}.`,
    );
  }

  // Check if destination ATA needs to be created
  let needsAtaCreation = false;
  try {
    await getAccount(solanaConnection, toAta);
  } catch {
    needsAtaCreation = true;
  }

  return buildAndSendSolanaTransaction(wallet, (tx, fromPk) => {
    if (needsAtaCreation) {
      tx.add(
        createAssociatedTokenAccountInstruction(fromPk, toAta, toPubkey, mintPubkey),
      );
    }
    tx.add(createTransferInstruction(fromAta, toAta, fromPk, tokenAmount));
  });
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
