import express from 'express';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { authenticateApiKey } from '../middlewares/apiKeyMiddleware.js';
import { validateBody } from '../middlewares/validateMiddleware.js';
import {
  createDepositSchema,
  verifyDepositSchema,
  rejectDepositSchema,
} from '../utils/validationSchemas.js';
import {
  createDeposit,
  listDeposits,
  getDeposit,
  getDepositStats,
  verifyDeposit,
  approveDeposit,
  rejectDeposit,
} from '../controllers/depositController.js';

const router = express.Router();

// External dashboard creates deposits via API key
router.post('/', authenticateApiKey, validateBody(createDepositSchema), createDeposit);

// Admin routes (JWT)
router.get('/', authenticateJWT, listDeposits);
router.get('/stats', authenticateJWT, getDepositStats);
router.get('/:id', authenticateJWT, getDeposit);
router.patch('/:id/verify', authenticateJWT, validateBody(verifyDepositSchema), verifyDeposit);
router.patch('/:id/approve', authenticateJWT, approveDeposit);
router.patch('/:id/reject', authenticateJWT, validateBody(rejectDepositSchema), rejectDeposit);

export default router;
