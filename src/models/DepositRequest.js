import mongoose from 'mongoose';
import { DEPOSIT_STATUS, VALID_CHAINS, VALID_TOKENS, VALID_WALLET_TYPES } from '../utils/constants.js';

const depositRequestSchema = new mongoose.Schema({
  source: { type: String, enum: ['crypto', 'fiat'], default: 'crypto', index: true },
  externalReference: { type: String, unique: true, sparse: true },
  fiatProvider: { type: String, default: null },
  fiatCurrency: { type: String, default: null },
  fiatAmount: { type: Number, default: null },

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
  depositTxHash: { type: String, unique: true, sparse: true },

  treasuryWalletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },

  skipDisbursement: { type: Boolean, default: false },

  reservationStatus: {
    type: String,
    enum: ['none', 'reserved', 'released', 'consumed'],
    default: 'none',
  },
  reservationReleasedAt: { type: Date, default: null },
  reservationConsumedAt: { type: Date, default: null },
  fiatDisbursementAttempts: { type: Number, default: 0 },
  fiatLastExecuteAt: { type: Date, default: null },
  fiatFinalizedAt: { type: Date, default: null },
  fiatLastCallbackEventId: { type: String, default: null },

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
depositRequestSchema.index({ source: 1, externalReference: 1 });
depositRequestSchema.index({ createdAt: -1 });

export default mongoose.model('DepositRequest', depositRequestSchema);
