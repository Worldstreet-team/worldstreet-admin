import * as walletService from '../services/walletService.js';
import { getWalletBalances } from '../services/balanceService.js';
import { sendFromWallet as sendFromWalletService } from '../services/sendService.js';

export const createWallet = async (req, res, next) => {
  try {
    const { chain, purpose, tokens, label } = req.body;
    const wallet = await walletService.createTreasuryWallet({ chain, purpose, tokens, label });
    res.status(201).json(wallet);
  } catch (err) {
    next(err);
  }
};

export const listWallets = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.chain) filter.chain = req.query.chain;
    if (req.query.purpose) filter.purpose = req.query.purpose;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
    const wallets = await walletService.getWallets(filter);
    res.json(wallets);
  } catch (err) {
    next(err);
  }
};

export const getWallet = async (req, res, next) => {
  try {
    const wallet = await walletService.getWalletById(req.params.id);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    res.json(wallet);
  } catch (err) {
    next(err);
  }
};

export const getWalletBalance = async (req, res, next) => {
  try {
    const wallet = await walletService.getWalletById(req.params.id);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    const balances = await getWalletBalances(wallet.chain, wallet.address, wallet.tokens);
    res.json({ walletId: wallet._id, address: wallet.address, chain: wallet.chain, balances });
  } catch (err) {
    next(err);
  }
};

export const updateWallet = async (req, res, next) => {
  try {
    const wallet = await walletService.updateWallet(req.params.id, req.body);
    if (!wallet) return res.status(404).json({ message: 'Wallet not found' });
    res.json(wallet);
  } catch (err) {
    next(err);
  }
};

export const sendFromWallet = async (req, res, next) => {
  try {
    const { toAddress, token, amount } = req.body;
    const result = await sendFromWalletService(req.params.id, { toAddress, token, amount });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
