import Transaction from '../models/Transaction.js';

export const listTransactions = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.chain) filter.chain = req.query.chain;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.token) filter.token = req.query.token;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('depositRequestId', 'userId userWalletAddress requestedAmount requestedToken status')
        .populate('walletId', 'address chain label')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(filter),
    ]);

    res.json({ transactions, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getTransaction = async (req, res, next) => {
  try {
    const tx = await Transaction.findById(req.params.id)
      .populate('depositRequestId')
      .populate('walletId', 'address chain label');
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });
    res.json(tx);
  } catch (err) {
    next(err);
  }
};
