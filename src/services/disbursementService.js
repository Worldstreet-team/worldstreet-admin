import { ethers } from 'ethers';
import privy, { authorizationPrivateKey } from '../config/privy.js';
import DepositRequest from '../models/DepositRequest.js';
import Transaction from '../models/Transaction.js';
import { findDisburseWallet } from './walletService.js';
import { TOKENS, CHAINS, DEPOSIT_STATUS, TX_STATUS } from '../utils/constants.js';

const CHAIN_CAIP2 = {
  ethereum: CHAINS.ETHEREUM.caip2,
  arbitrum: CHAINS.ARBITRUM.caip2,
};

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

  // Build the ERC-20 transfer tx
  const data = buildTransferData(
    deposit.userWalletAddress,
    deposit.requestedAmount,
    tokenInfo.decimals,
  );

  // Mark as processing
  deposit.status = DEPOSIT_STATUS.PROCESSING;
  deposit.disburseWalletId = disburseWallet._id;
  await deposit.save();

  try {
    // Send via Privy
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

    // Record the transaction
    const tx = await Transaction.create({
      depositRequestId: deposit._id,
      walletId: disburseWallet._id,
      chain: deposit.chain,
      token: deposit.requestedToken,
      amount: deposit.requestedAmount,
      toAddress: deposit.userWalletAddress,
      txHash: result.hash,
      status: TX_STATUS.SUBMITTED,
    });

    // Update deposit
    deposit.disburseTxHash = result.hash;
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
