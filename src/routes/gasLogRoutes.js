import express from 'express';
import { authenticateApiKey } from '../middlewares/apiKeyMiddleware.js';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { createGasLog, getGasStats } from '../controllers/gasLogController.js';

const router = express.Router();

// POST /api/gas-logs — called by dashboard frontend (fire-and-forget), API key auth
router.post('/', authenticateApiKey, createGasLog);

// GET /api/gas-logs/stats — admin dashboard, JWT auth
router.get('/stats', authenticateJWT, getGasStats);

export default router;
