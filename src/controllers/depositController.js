import DepositRequest from '../models/DepositRequest.js';
import { findReceiveWallet } from '../services/walletService.js';
import { disburse } from '../services/disbursementService.js';
import { DEPOSIT_STATUS } from '../utils/constants.js';

/**
 * Create a deposit request (called from external dashboard via API key).
 */
export const createDeposit = async (req, res, next) => {
  try {
    const {
      userId, userWalletAddress, chain, requestedToken, requestedAmount,
      depositChain, depositToken, depositAmount, description,
    } = req.body;

    // Find the receive wallet on the deposit chain
    const receiveWallet = await findReceiveWallet(depositChain);
    if (!receiveWallet) {
      return res.status(400).json({ message: `No active receive wallet for chain: ${depositChain}` });
    }

    // Set expiry to 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const deposit = await DepositRequest.create({
      userId,
      userWalletAddress,
      chain,
      requestedToken,
      requestedAmount,
      depositChain,
      depositToken,
      depositAmount,
      description: description || '',
      treasuryWalletId: receiveWallet._id,
      expiresAt,
    });

    res.status(201).json({
      deposit,
      treasuryAddress: receiveWallet.address,
      treasuryChain: receiveWallet.chain,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * List deposit requests with optional filters.
 */
export const listDeposits = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.chain) filter.chain = req.query.chain;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [deposits, total] = await Promise.all([
      DepositRequest.find(filter)
        .populate('treasuryWalletId', 'address chain label')
        .populate('disburseWalletId', 'address chain label')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      DepositRequest.countDocuments(filter),
    ]);

    res.json({ deposits, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single deposit request.
 */
export const getDeposit = async (req, res, next) => {
  try {
    const deposit = await DepositRequest.findById(req.params.id)
      .populate('treasuryWalletId', 'address chain label')
      .populate('disburseWalletId', 'address chain label');
    if (!deposit) return res.status(404).json({ message: 'Deposit request not found' });
    res.json(deposit);
  } catch (err) {
    next(err);
  }
};

/**
 * Get aggregate stats for deposit requests.
 */
export const getDepositStats = async (req, res, next) => {
  try {
    const [statusCounts, volumeByToken] = await Promise.all([
      DepositRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      DepositRequest.aggregate([
        { $match: { status: DEPOSIT_STATUS.COMPLETED } },
        { $group: { _id: '$requestedToken', totalAmount: { $sum: '$requestedAmount' }, count: { $sum: 1 } } },
      ]),
    ]);

    res.json({ statusCounts, volumeByToken });
  } catch (err) {
    next(err);
  }
};

/**
 * Manually verify a deposit (admin confirms on-chain tx).
 */
export const verifyDeposit = async (req, res, next) => {
  try {
    const deposit = await DepositRequest.findById(req.params.id);
    if (!deposit) return res.status(404).json({ message: 'Deposit request not found' });

    if (deposit.status !== DEPOSIT_STATUS.PENDING) {
      return res.status(400).json({ message: `Cannot verify: status is "${deposit.status}"` });
    }

    deposit.depositTxHash = req.body.depositTxHash;
    deposit.status = DEPOSIT_STATUS.VERIFIED;
    deposit.verifiedAt = new Date();
    await deposit.save();

    res.json(deposit);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'This transaction hash has already been used' });
    }
    next(err);
  }
};

/**
 * Approve a verified deposit and trigger auto-disbursement.
 */
export const approveDeposit = async (req, res, next) => {
  try {
    const { deposit, tx } = await disburse(req.params.id);
    res.json({ deposit, transaction: tx });
  } catch (err) {
    next(err);
  }
};

/**
 * Reject a deposit request.
 */
export const rejectDeposit = async (req, res, next) => {
  try {
    const deposit = await DepositRequest.findById(req.params.id);
    if (!deposit) return res.status(404).json({ message: 'Deposit request not found' });

    if ([DEPOSIT_STATUS.COMPLETED, DEPOSIT_STATUS.PROCESSING].includes(deposit.status)) {
      return res.status(400).json({ message: `Cannot reject: status is "${deposit.status}"` });
    }

    deposit.status = DEPOSIT_STATUS.REJECTED;
    deposit.adminNotes = req.body.adminNotes || '';
    await deposit.save();

    res.json(deposit);
  } catch (err) {
    next(err);
  }
};
