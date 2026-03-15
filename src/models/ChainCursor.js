import mongoose from 'mongoose';
import { VALID_CHAINS } from '../utils/constants.js';

const chainCursorSchema = new mongoose.Schema({
  walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true, unique: true },
  chain: { type: String, required: true, enum: VALID_CHAINS },
  lastBlock: { type: Number, default: null },
  lastSignature: { type: String, default: null },
}, { timestamps: true });

export default mongoose.model('ChainCursor', chainCursorSchema);
