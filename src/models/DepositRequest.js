import mongoose from 'mongoose';
import { DEPOSIT_STATUS, VALID_CHAINS, VALID_TOKENS, VALID_WALLET_TYPES } from '../utils/constants.js';

const depositRequestSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userWalletAddress: { type: String, required: true },
  chain: { type: String, required: true, enum: VALID_CHAINS },
  walletType: { type: String, required: true, enum: VALID_WALLET_TYPES },
  requestedToken: { type: String, required: true, enum: VALID_TOKENS },
  requestedAmount: { type: Number, required: true, min: 0 },

  depositChain: { type: String, required: true, enum: VALID_CHAINS },
  depositToken: { type: String, required: true, enum: VALID_TOKENS },
  depositAmount: { type: Number, required: true, min: 0 },
  depositFromAddress: { type: String, default: null },
  depositTxHash: { type: String, default: null, unique: true, sparse: true },

  treasuryWalletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },

  disburseTxHash: { type: String, default: null },
  disburseWalletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', default: null },

  status: {
    type: String,
    required: true,
    enum: Object.values(DEPOSIT_STATUS),
    default: DEPOSIT_STATUS.PENDING,
  },
  description: { type: String, default: '' },
  adminNotes: { type: String, default: '' },

  expiresAt: { type: Date, required: true },
  verifiedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

depositRequestSchema.index({ status: 1 });
depositRequestSchema.index({ userId: 1 });
depositRequestSchema.index({ walletType: 1 });
depositRequestSchema.index({ createdAt: -1 });

export default mongoose.model('DepositRequest', depositRequestSchema);
