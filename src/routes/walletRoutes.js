import express from 'express';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { validateBody } from '../middlewares/validateMiddleware.js';
import { createWalletSchema, updateWalletSchema, sendTokenSchema } from '../utils/validationSchemas.js';
import {
  createWallet,
  listWallets,
  getWallet,
  getWalletBalance,
  updateWallet,
  sendFromWallet,
} from '../controllers/walletController.js';

const router = express.Router();

router.use(authenticateJWT);

router.post('/', validateBody(createWalletSchema), createWallet);
router.get('/', listWallets);
router.get('/:id', getWallet);
router.get('/:id/balance', getWalletBalance);
router.patch('/:id', validateBody(updateWalletSchema), updateWallet);
router.post('/:id/send', validateBody(sendTokenSchema), sendFromWallet);

export default router;
