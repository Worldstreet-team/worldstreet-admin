import Joi from 'joi';

// Address patterns
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().min(6).required(),
});

export const createWalletSchema = Joi.object({
  chain: Joi.string().valid('ethereum', 'arbitrum', 'solana', 'tron').required(),
  purpose: Joi.string().valid('receive', 'disburse', 'fees').required(),
  tokens: Joi.array().items(Joi.string().valid('USDC', 'USDT')).min(0).default([]),
  label: Joi.string().max(100).optional(),
});

export const updateWalletSchema = Joi.object({
  label: Joi.string().max(100).optional(),
  isActive: Joi.boolean().optional(),
}).min(1);

export const sendTokenSchema = Joi.object({
  toAddress: Joi.string().required(),
  token: Joi.string().valid('USDC', 'USDT', 'native').required(),
  amount: Joi.string().required(), // String to preserve decimal precision
});

export const createDepositSchema = Joi.object({
  userId: Joi.string().required(),
  userWalletAddress: Joi.alternatives().try(
    Joi.string().pattern(EVM_ADDRESS).messages({ 'string.pattern.base': 'Invalid EVM wallet address' }),
    Joi.string().pattern(SOLANA_ADDRESS).messages({ 'string.pattern.base': 'Invalid Solana wallet address' }),
    Joi.string().pattern(TRON_ADDRESS).messages({ 'string.pattern.base': 'Invalid TRON wallet address' }),
  ).required(),
  depositFromAddress: Joi.alternatives().try(
    Joi.string().pattern(EVM_ADDRESS),
    Joi.string().pattern(SOLANA_ADDRESS),
    Joi.string().pattern(TRON_ADDRESS),
  ).optional(),
  walletType: Joi.string().valid('spot', 'futures').required(),
  chain: Joi.string().valid('ethereum', 'arbitrum', 'solana', 'tron').default('arbitrum'),
  requestedToken: Joi.string().valid('USDC', 'USDT').default('USDC'),
  requestedAmount: Joi.number().positive().required(),
  depositChain: Joi.string().valid('ethereum', 'arbitrum', 'solana', 'tron').required(),
  depositToken: Joi.string().valid('USDC', 'USDT').required(),
  depositAmount: Joi.number().positive().required(),
  description: Joi.string().max(500).optional(),
});

export const verifyDepositSchema = Joi.object({
  depositTxHash: Joi.string().required()
    .messages({ 'string.base': 'Invalid transaction hash' }),
});

export const rejectDepositSchema = Joi.object({
  adminNotes: Joi.string().max(500).optional(),
});
