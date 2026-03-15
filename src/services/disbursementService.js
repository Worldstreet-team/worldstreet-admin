import { ethers } from 'ethers';
import {
  Connection,
  PublicKey,
  Transaction as SolTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import privy, { authorizationPrivateKey } from '../config/privy.js';
import config from '../config/index.js';
import DepositRequest from '../models/DepositRequest.js';
import Transaction from '../models/Transaction.js';
import { findDisburseWallet } from './walletService.js';
import { TOKENS, CHAINS, DEPOSIT_STATUS, TX_STATUS, TX_TYPE, isEvmChain, isSolanaChain } from '../utils/constants.js';

const CHAIN_CAIP2 = {
  ethereum: CHAINS.ETHEREUM.caip2,
  arbitrum: CHAINS.ARBITRUM.caip2,
};

const solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed');

/**
 * Build an ERC-20 transfer calldata.
 */
const buildTransferData = (toAddress, amount, decimals) => {
  const iface = new ethers.Interface([
    'function transfer(address to, uint256 amount) returns (bool)',
  ]);
  const amountWei = ethers.parseUnits(String(amount), decimals);
  return iface.encodeFunctionData('transfer', [toAddress, amountWei]);
};

/**
 * Send ERC-20 tokens via Privy on an EVM chain.
 */
const disburseEvm = async (disburseWallet, deposit, tokenInfo, contractAddress) => {
  const data = buildTransferData(
    deposit.userWalletAddress,
    deposit.requestedAmount,
    tokenInfo.decimals,
  );
  const caip2 = CHAIN_CAIP2[deposit.chain];

  const result = await privy.wallets().ethereum().sendTransaction(
    disburseWallet.privyWalletId,
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

/**
 * Send SPL tokens via Privy on Solana.
 */
const disburseSolana = async (disburseWallet, deposit, tokenInfo, mintAddress) => {
  const fromPubkey = new PublicKey(disburseWallet.address);
  const toPubkey = new PublicKey(deposit.userWalletAddress);
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

  const tokenAmount = Math.round(parseFloat(deposit.requestedAmount) * Math.pow(10, tokenInfo.decimals));
  tx.add(createTransferInstruction(fromAta, toAta, fromPubkey, tokenAmount));

  const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

  const result = await privy.wallets().solana().signAndSendTransaction(
    disburseWallet.privyWalletId,
    {
      caip2: CHAINS.SOLANA.caip2,
      transaction: serialized,
      authorization_context: {
        authorization_private_keys: [authorizationPrivateKey],
      },
    },
  );
  return result;
};

/**
 * Disburse tokens to a user's spot wallet.
 * Called after a deposit is verified and approved.
 */
export const disburse = async (depositRequestId) => {
  const deposit = await DepositRequest.findById(depositRequestId);
  if (!deposit) throw new Error('Deposit request not found');
  if (deposit.status !== DEPOSIT_STATUS.VERIFIED) {
    throw new Error(`Cannot disburse: deposit status is "${deposit.status}", expected "verified"`);
  }

  // Find the disburse wallet for the target chain
  const disburseWallet = await findDisburseWallet(deposit.chain);
  if (!disburseWallet) throw new Error(`No active disburse wallet for chain: ${deposit.chain}`);

  const tokenInfo = TOKENS[deposit.requestedToken];
  if (!tokenInfo) throw new Error(`Unknown token: ${deposit.requestedToken}`);

  const contractAddress = tokenInfo[deposit.chain];
  if (!contractAddress) throw new Error(`Token ${deposit.requestedToken} not on ${deposit.chain}`);

  // Mark as processing
  deposit.status = DEPOSIT_STATUS.PROCESSING;
  deposit.disburseWalletId = disburseWallet._id;
  await deposit.save();

  try {
    // Send via Privy — branch by chain type
    let result;
    if (isEvmChain(deposit.chain)) {
      result = await disburseEvm(disburseWallet, deposit, tokenInfo, contractAddress);
    } else if (isSolanaChain(deposit.chain)) {
      result = await disburseSolana(disburseWallet, deposit, tokenInfo, contractAddress);
    } else {
      throw new Error(`Unsupported chain for disbursement: ${deposit.chain}`);
    }

    const txHash = result.hash || result.signature || result.transaction_hash;

    // Record the transaction
    const tx = await Transaction.create({
      depositRequestId: deposit._id,
      walletId: disburseWallet._id,
      chain: deposit.chain,
      token: deposit.requestedToken,
      amount: deposit.requestedAmount,
      toAddress: deposit.userWalletAddress,
      txHash,
      type: TX_TYPE.DISBURSEMENT,
      status: TX_STATUS.SUBMITTED,
    });

    // Update deposit
    deposit.disburseTxHash = txHash;
    deposit.status = DEPOSIT_STATUS.COMPLETED;
    deposit.completedAt = new Date();
    await deposit.save();

    return { deposit, tx };
  } catch (err) {
    deposit.status = DEPOSIT_STATUS.FAILED;
    deposit.adminNotes = `Disbursement failed: ${err.message}`;
    await deposit.save();
    throw err;
  }
};
