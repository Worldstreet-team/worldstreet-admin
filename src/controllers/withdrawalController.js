import { findDisburseWallet } from '../services/walletService.js';
import { sendFromWallet } from '../services/sendService.js';
import Transaction from '../models/Transaction.js';
import { TX_TYPE, TX_STATUS } from '../utils/constants.js';

/**
 * POST /api/withdrawals
 * Called by dashboard (API-key auth) to send tokens from treasury to user.
 */
export const createWithdrawal = async (req, res, next) => {
  try {
    const { userId, toAddress, chain, token, amount } = req.body;

    // Find an active disburse wallet for the requested chain
    const disburseWallet = await findDisburseWallet(chain);
    if (!disburseWallet) {
      return res.status(503).json({
        error: `No active disburse wallet available for chain: ${chain}`,
      });
    }

    // Send tokens from the disburse wallet to the user's address
    const { tx, wallet } = await sendFromWallet(disburseWallet._id, {
      toAddress,
      token,
      amount: String(amount),
    });

    // Update the transaction type to WITHDRAWAL (sendFromWallet defaults to MANUAL_SEND)
    await Transaction.findByIdAndUpdate(tx._id, {
      $set: { type: TX_TYPE.WITHDRAWAL, description: `SpotV2 withdrawal for user ${userId}` },
    });

    res.status(200).json({
      success: true,
      txHash: tx.txHash,
      walletId: wallet._id,
      transactionId: tx._id,
    });
  } catch (err) {
    next(err);
  }
};
