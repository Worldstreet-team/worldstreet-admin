import mongoose from 'mongoose';
import { TX_STATUS, VALID_CHAINS, VALID_TOKENS } from '../utils/constants.js';

const transactionSchema = new mongoose.Schema({
  depositRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'DepositRequest', required: true },
  walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
  chain: { type: String, required: true, enum: VALID_CHAINS },
  token: { type: String, required: true, enum: VALID_TOKENS },
  amount: { type: Number, required: true, min: 0 },
  toAddress: { type: String, required: true },
  txHash: { type: String, required: true, unique: true },
  status: {
    type: String,
    required: true,
    enum: Object.values(TX_STATUS),
    default: TX_STATUS.SUBMITTED,
  },
  blockNumber: { type: Number, default: null },
  gasUsed: { type: String, default: null },
}, { timestamps: true });

transactionSchema.index({ depositRequestId: 1 });
transactionSchema.index({ txHash: 1 });
transactionSchema.index({ createdAt: -1 });

export default mongoose.model('Transaction', transactionSchema);
