import Joi from 'joi';

export const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().min(6).required(),
});

export const createWalletSchema = Joi.object({
  chain: Joi.string().valid('ethereum', 'arbitrum').required(),
  purpose: Joi.string().valid('receive', 'disburse').required(),
  tokens: Joi.array().items(Joi.string().valid('USDC', 'USDT')).min(1).required(),
  label: Joi.string().max(100).optional(),
});

export const updateWalletSchema = Joi.object({
  label: Joi.string().max(100).optional(),
  isActive: Joi.boolean().optional(),
}).min(1);

export const createDepositSchema = Joi.object({
  userId: Joi.string().required(),
  userWalletAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required()
    .messages({ 'string.pattern.base': 'Invalid EVM wallet address' }),
  chain: Joi.string().valid('ethereum', 'arbitrum').default('arbitrum'),
  requestedToken: Joi.string().valid('USDC', 'USDT').default('USDC'),
  requestedAmount: Joi.number().positive().required(),
  depositChain: Joi.string().valid('ethereum', 'arbitrum').required(),
  depositToken: Joi.string().valid('USDC', 'USDT').required(),
  depositAmount: Joi.number().positive().required(),
  description: Joi.string().max(500).optional(),
});

export const verifyDepositSchema = Joi.object({
  depositTxHash: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required()
    .messages({ 'string.pattern.base': 'Invalid transaction hash' }),
});

export const rejectDepositSchema = Joi.object({
  adminNotes: Joi.string().max(500).optional(),
});
