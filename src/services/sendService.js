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
import { TronWeb } from 'tronweb';
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
  isTronChain,
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

const tronWeb = new TronWeb({
  fullHost: config.tronRpcUrl,
  headers: config.tronApiKey ? { 'TRON-PRO-API-KEY': config.tronApiKey } : {},
});

const SUN_PER_TRX = 1_000_000;

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

// ── TRON helpers ───────────────────────────────────────────────

/**
 * Sign a TRON transaction hash via Privy rawSign and recover the 65-byte signature.
 * Privy returns 64-byte (r||s). TRON needs 65 bytes with recovery ID v appended.
 */
const signTronTransaction = async (wallet, txID) => {
  const hash = txID.startsWith('0x') ? txID : `0x${txID}`;

  // privy.wallets() returns PrivyWalletsService which exposes rawSign() (no underscore).
  // It takes authorization_context (not a raw header string).
  const signResult = await privy.wallets().rawSign(
    wallet.privyWalletId,
    {
      params: { hash },
      authorization_context: {
        authorization_private_keys: [authorizationPrivateKey],
      },
    },
  );

  // signResult.signature is 0x-prefixed 64-byte hex (r || s)
  const sig64 = (signResult.signature || signResult.data?.signature || '').replace(/^0x/, '');
  if (!sig64 || sig64.length !== 128) {
    throw new Error(`Privy rawSign returned unexpected signature: ${JSON.stringify(signResult)}`);
  }

  // TRON requires 65-byte signature: r (32) + s (32) + v (1)
  // TronWeb.Trx.ecRecover expects a SignedTransaction object, not raw strings.
  // Use ethers.recoverAddress instead — Tron hex address is '41' + EVM 20-byte hex.
  const walletTronHex = TronWeb.address.toHex(wallet.address).toLowerCase(); // '41xxxxxxxx...'
  const walletEvmAddr = ('0x' + walletTronHex.slice(2)).toLowerCase();

  for (const v of [27, 28]) {
    try {
      const sig = ethers.Signature.from({
        r: '0x' + sig64.slice(0, 64),
        s: '0x' + sig64.slice(64, 128),
        v,
      });
      const recovered = ethers.recoverAddress(hash, sig).toLowerCase();
      if (recovered === walletEvmAddr) {
        return sig64 + v.toString(16); // '1b' (27) or '1c' (28)
      }
    } catch {
      // try the other v
    }
  }

  // If neither recovery ID worked, something is fundamentally wrong — fail loudly
  throw new Error(
    `TRON signature recovery failed for wallet ${wallet.address}. ` +
    `Neither v=27 nor v=28 recovers the expected address.`,
  );
};

const sendTronNative = async (wallet, toAddress, amount) => {
  const amountSun = Math.round(parseFloat(amount) * SUN_PER_TRX);
  const fromHex = TronWeb.address.toHex(wallet.address);
  const toHex = TronWeb.address.toHex(toAddress);

  // Pre-flight balance check
  const balance = await tronWeb.trx.getBalance(wallet.address);
  if (balance < amountSun) {
    throw new Error(
      `Insufficient TRX balance. Wallet has ${balance / SUN_PER_TRX} TRX ` +
      `but tried to send ${amount} TRX.`,
    );
  }

  // Build unsigned transaction
  const unsignedTx = await tronWeb.transactionBuilder.sendTrx(toHex, amountSun, fromHex);
  const txID = unsignedTx.txID;

  // Sign via Privy
  const signature = await signTronTransaction(wallet, txID);
  const signedTx = { ...unsignedTx, signature: [signature] };

  // Broadcast
  const result = await tronWeb.trx.sendRawTransaction(signedTx);
  if (!result.result) {
    throw new Error(`TRON broadcast failed: ${JSON.stringify(result)}`);
  }
  if (!result.txid) {
    throw new Error(`TRON broadcast succeeded but no txid returned: ${JSON.stringify(result)}`);
  }

  return { transaction_hash: result.txid };
};

const sendTrc20Token = async (wallet, toAddress, token, amount) => {
  const tokenInfo = TOKENS[token];
  if (!tokenInfo) throw new Error(`Unknown token: ${token}`);

  const contractAddress = tokenInfo.tron;
  if (!contractAddress) throw new Error(`Token ${token} not available on tron`);

  const tokenAmount = Math.round(parseFloat(amount) * Math.pow(10, tokenInfo.decimals));
  const fromHex = TronWeb.address.toHex(wallet.address);

  // Build TRC-20 transfer via triggerSmartContract
  const { transaction: unsignedTx } = await tronWeb.transactionBuilder.triggerSmartContract(
    contractAddress,
    'transfer(address,uint256)',
    { feeLimit: 100_000_000 }, // 100 TRX fee limit
    [
      { type: 'address', value: toAddress },
      { type: 'uint256', value: tokenAmount },
    ],
    fromHex,
  );

  const txID = unsignedTx.txID;

  // Sign via Privy
  const signature = await signTronTransaction(wallet, txID);
  const signedTx = { ...unsignedTx, signature: [signature] };

  // Broadcast
  const result = await tronWeb.trx.sendRawTransaction(signedTx);
  if (!result.result) {
    throw new Error(`TRON broadcast failed: ${JSON.stringify(result)}`);
  }
  if (!result.txid) {
    throw new Error(`TRON broadcast succeeded but no txid returned: ${JSON.stringify(result)}`);
  }

  return { transaction_hash: result.txid };
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
  } else if (isTronChain(wallet.chain)) {
    if (token === 'native') {
      result = await sendTronNative(wallet, toAddress, amount);
    } else {
      result = await sendTrc20Token(wallet, toAddress, token, amount);
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
