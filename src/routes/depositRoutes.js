import express from 'express';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authenticateApiKey } from '../middlewares/apiKeyMiddleware.js';
import { validateBody } from '../middlewares/validateMiddleware.js';
import {
  createDepositSchema,
  fiatCancelSchema,
  fiatExecuteSchema,
  fiatReserveSchema,
  verifyDepositSchema,
  rejectDepositSchema,
} from '../utils/validationSchemas.js';
import {
  createDeposit,
  cancelFiatDepositRequest,
  executeFiatDepositRequest,
  getFiatDepositAvailability,
  listDeposits,
  getDeposit,
  getDepositStats,
  reserveFiatDepositRequest,
  verifyDeposit,
  approveDeposit,
  rejectDeposit,
  notifyDepositTx,
} from '../controllers/depositController.js';

const router = express.Router();

// External dashboard creates deposits via API key
router.post('/', authenticateApiKey, validateBody(createDepositSchema), createDeposit);

// Dashboard polls deposit status via API key
router.get('/status/:id', authenticateApiKey, getDeposit);

router.get('/fiat/availability', authenticateApiKey, getFiatDepositAvailability);
router.post('/fiat/reserve', authenticateApiKey, validateBody(fiatReserveSchema), reserveFiatDepositRequest);
router.post('/fiat/execute', authenticateApiKey, validateBody(fiatExecuteSchema), executeFiatDepositRequest);
router.post('/fiat/cancel', authenticateApiKey, validateBody(fiatCancelSchema), cancelFiatDepositRequest);

// Dashboard notifies admin of txHash after on-chain send
router.patch('/:id/notify-tx', authenticateApiKey, notifyDepositTx);

// Admin routes (JWT)
router.get('/', authenticateJWT, listDeposits);
router.get('/stats', authenticateJWT, getDepositStats);
router.get('/:id', authenticateJWT, getDeposit);
router.patch('/:id/verify', authenticateJWT, validateBody(verifyDepositSchema), verifyDeposit);
router.patch('/:id/approve', authenticateJWT, approveDeposit);
router.patch('/:id/reject', authenticateJWT, validateBody(rejectDepositSchema), rejectDeposit);

export default router;
