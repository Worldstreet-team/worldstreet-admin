import express from 'express';
import { authenticateJWT } from '../middlewares/authMiddleware.js';
import { validateBody } from '../middlewares/validateMiddleware.js';
import { loginSchema } from '../utils/validationSchemas.js';
import { loginAdmin } from '../controllers/adminController.js';

const router = express.Router();

router.post('/login', validateBody(loginSchema), loginAdmin);
router.get('/dashboard', authenticateJWT, (req, res) => {
  res.json({ message: 'Welcome Super Admin!' });
});

export default router;
