import express from 'express';
import { authenticateApiKey } from '../middlewares/apiKeyMiddleware.js';
import { validateBody } from '../middlewares/validateMiddleware.js';
import { createWithdrawalSchema } from '../utils/validationSchemas.js';
import { createWithdrawal } from '../controllers/withdrawalController.js';

const router = express.Router();

// Dashboard sends withdrawal requests via API key
router.post('/', authenticateApiKey, validateBody(createWithdrawalSchema), createWithdrawal);

export default router;
