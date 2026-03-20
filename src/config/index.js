import dotenv from 'dotenv';
dotenv.config();

export default {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',

  // Privy
  privyAppId: process.env.PRIVY_APP_ID,
  privyAppSecret: process.env.PRIVY_APP_SECRET,
  privyAuthorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,

  // Dashboard API Key
  dashboardApiKey: process.env.DASHBOARD_API_KEY,

  // RPC
  ethereumRpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  arbitrumRpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  tronRpcUrl: process.env.TRON_RPC_URL || 'https://api.trongrid.io',
  tronGridUrl: process.env.TRON_GRID_URL || 'https://api.trongrid.io',
  tronApiKey: process.env.TRON_API_KEY || '',

  // Auto-disburse polling
  autoDisburseEnabled: process.env.AUTO_DISBURSE_ENABLED !== 'false',
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS, 10) || 30,
  requiredConfirmationsEth: parseInt(process.env.REQUIRED_CONFIRMATIONS_ETH, 10) || 12,
};
