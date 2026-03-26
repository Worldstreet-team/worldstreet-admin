import mongoose from 'mongoose';

const gasSponsorshipLogSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  chain: { type: String, required: true, index: true },
  txHash: { type: String, required: true, unique: true },
  method: { type: String, default: null },
  estimatedCostUSD: { type: Number, default: 0 },
}, { timestamps: true });

gasSponsorshipLogSchema.index({ createdAt: -1 });
gasSponsorshipLogSchema.index({ chain: 1, createdAt: -1 });

export default mongoose.model('GasSponsorshipLog', gasSponsorshipLogSchema);
