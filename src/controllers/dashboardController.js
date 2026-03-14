import Wallet from '../models/Wallet.js';
import DepositRequest from '../models/DepositRequest.js';
import Transaction from '../models/Transaction.js';
import { getWalletBalances } from '../services/balanceService.js';
import { DEPOSIT_STATUS } from '../utils/constants.js';

export const getOverview = async (req, res, next) => {
  try {
    // Wallet balances
    const wallets = await Wallet.find({ isActive: true });
    const walletBalances = await Promise.all(
      wallets.map(async (w) => {
        try {
          const balances = await getWalletBalances(w.chain, w.address, w.tokens);
          return {
            id: w._id,
            label: w.label,
            address: w.address,
            chain: w.chain,
            purpose: w.purpose,
            balances,
          };
        } catch {
          return {
            id: w._id,
            label: w.label,
            address: w.address,
            chain: w.chain,
            purpose: w.purpose,
            balances: { error: 'Failed to fetch' },
          };
        }
      })
    );

    // Deposit request counts by status
    const statusCounts = await DepositRequest.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const pendingCount = statusCounts.find((s) => s._id === DEPOSIT_STATUS.PENDING)?.count || 0;

    // Today's disbursement volume
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayVolume = await Transaction.aggregate([
      { $match: { createdAt: { $gte: startOfDay } } },
      { $group: { _id: '$token', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Recent activity (last 10 completed/failed deposits)
    const recentActivity = await DepositRequest.find({
      status: { $in: [DEPOSIT_STATUS.COMPLETED, DEPOSIT_STATUS.FAILED, DEPOSIT_STATUS.VERIFIED] },
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('userId requestedToken requestedAmount status updatedAt chain');

    res.json({
      walletBalances,
      statusCounts,
      pendingCount,
      todayVolume,
      recentActivity,
    });
  } catch (err) {
    next(err);
  }
};
