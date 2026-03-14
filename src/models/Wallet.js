import mongoose from 'mongoose';
import { VALID_CHAINS, VALID_TOKENS, VALID_PURPOSES } from '../utils/constants.js';

const walletSchema = new mongoose.Schema({
  privyWalletId: { type: String, required: true, unique: true },
  address: { type: String, required: true },
  chain: { type: String, required: true, enum: VALID_CHAINS },
  chainId: { type: String, required: true },
  purpose: { type: String, required: true, enum: VALID_PURPOSES },
  tokens: [{ type: String, enum: VALID_TOKENS }],
  label: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('Wallet', walletSchema);
