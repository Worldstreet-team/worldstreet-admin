import express from 'express';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { listTransactions, getTransaction } from '../controllers/transactionController.js';

const router = express.Router();

router.use(authenticateJWT);

router.get('/', listTransactions);
router.get('/:id', getTransaction);

export default router;
