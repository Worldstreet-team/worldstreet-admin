import express from 'express';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { getOverview } from '../controllers/dashboardController.js';

const router = express.Router();

router.use(authenticateJWT);

router.get('/overview', getOverview);

export default router;
