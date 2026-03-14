# Express Admin Service (JWT + Mongoose + Render)

## 📂 Folder Structure

project-root/ ├── src/ │   ├── config/ │   │   ├── index.js │   │   └── db.js │   ├── models/ │   │   └── User.js │   ├── controllers/ │   │   └── adminController.js │   ├── routes/ │   │   └── adminRoutes.js │   ├── services/ │   │   └── authService.js │   ├── middlewares/ │   │   ├── authMiddleware.js │   │   └── validateMiddleware.js │   ├── utils/ │   │   ├── errorHandler.js │   │   └── validationSchemas.js │   └── app.js ├── .env.example ├── package.json └── README.md


---

## 📄 File Contents

### `src/config/index.js`
```js
import dotenv from 'dotenv';
dotenv.config();

export default {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
};


import mongoose from 'mongoose';
import config from './index.js';

export const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
};

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['superadmin'], default: 'superadmin' },
}, { timestamps: true });

export default mongoose.model('User', userSchema);



import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import config from '../config/index.js';

export const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
};

export const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};


import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  jwt.verify(token, config.jwtSecret, (err, user) => {
    if (err) return res.status(403).json({ message: 'Forbidden' });
    req.user = user;
    next();
  });
};



export const validateBody = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  next();
};


import Joi from 'joi';

export const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().min(6).required(),
});


export const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal Server Error' });
};


import User from '../models/User.js';
import { generateToken, verifyPassword } from '../services/authService.js';

export const loginAdmin = async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });

  if (!user) return res.status(404).json({ message: 'User not found' });

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

  const token = generateToken(user);
  res.json({ token });
};


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




import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { connectDB } from './config/db.js';
import adminRoutes from './routes/adminRoutes.js';
import config from './config/index.js';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({ origin: 'https://your-frontend-domain.com' }));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Routes
app.use('/api/admin', adminRoutes);

// Start server
connectDB();
app.listen(config.port, () => {
  console.log(`🚀 Server running on port ${config.port}`);
});



NODE_ENV=development
PORT=3000
MONGO_URI=mongodb+srv://user:password@cluster/dbname
JWT_SECRET=supersecretkey


{
  "name": "express-admin-service",
  "version": "1.0.0",
  "main": "src/app.js",
  "type": "module",
  "scripts": {
    "start": "node src/app.js"
  },
  "dependencies": {
    "bcrypt": "^5.1.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "express": "^4.18.2",
    "express-rate-limit": "^6.7.0",
    "helmet": "^6.0.1",
    "joi": "^17.9.2",
    "jsonwebtoken": "^9.0.0",
    "mongoose": "^7.0.3"
  }
}

# Express Admin Service

## Features
- JWT-based authentication (superadmin role)
- MongoDB with Mongoose
- Input validation with Joi
- Security middleware (Helmet, CORS, Rate limiting)
- Modular folder structure

## Deployment on Render
1. Push this repo to GitHub.
2. Create a new Web Service on Render.
3. Add environment variables (`MONGO_URI`, `JWT_SECRET`, `NODE_ENV`).
4. Build Command: `npm install`
5. Start Command: `node src/app.js`
6. Render automatically sets `PORT`, ensure config uses `process.env.PORT`.