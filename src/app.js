import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { connectDB } from './config/db.js';
import adminRoutes from './routes/adminRoutes.js';
import walletRoutes from './routes/walletRoutes.js';
import depositRoutes from './routes/depositRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import withdrawalRoutes from './routes/withdrawalRoutes.js';
import gasLogRoutes from './routes/gasLogRoutes.js';
import { errorHandler } from './utils/errorHandler.js';
import config from './config/index.js';
import { startJobs } from './jobs/startJobs.js';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/deposits', depositRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/gas-logs', gasLogRoutes);

// Error handler (must be after routes)
app.use(errorHandler);

// Start server
const start = async () => {
  await connectDB();
  startJobs();
  app.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
  });
};

start();
