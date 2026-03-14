# Product Requirements Document (PRD)
## WorldStreet Admin — Treasury & Deposit Management Service

**Version:** 1.0  
**Date:** March 14, 2026  
**Status:** Draft

---

## 1. Overview

WorldStreet Admin is a backend service + visual dashboard that manages **crypto treasury wallets** and **user spot-wallet deposit requests**. The admin service creates and controls treasury wallets on Ethereum and Arbitrum via **Privy's server-side wallet infrastructure**, receives stablecoin deposits from end users, and automatically disburses tokens (primarily USDC on Arbitrum) to user spot wallets upon verification.

---

## 2. Goals

- Provide a secure, server-controlled treasury wallet system on Ethereum and Arbitrum using Privy.
- Automate the deposit-request lifecycle: receive stablecoins → verify → disburse to user spot wallets.
- Give the superadmin a visual dashboard to monitor wallets, balances, deposit requests, and transaction history.
- Minimize manual intervention — auto-send where possible, manual approval as fallback.

---

## 3. Architecture

### 3.1 System Context

```
┌─────────────────────┐         ┌──────────────────────────┐
│  Crypto Dashboard   │────────▶│   WorldStreet Admin API  │
│  (user-facing app)  │  REST   │   (this service)         │
└─────────────────────┘         │                          │
                                │  ┌────────────────────┐  │
                                │  │  Privy Wallet API   │  │
                                │  │  (server-side SDK)  │  │
                                │  └────────┬───────────┘  │
                                │           │              │
                                │  ┌────────▼───────────┐  │
                                │  │  Treasury Wallets   │  │
                                │  │  • ETH (receive)    │  │
                                │  │  • ARB (disburse)   │  │
                                │  └────────────────────┘  │
                                │                          │
                                │  ┌────────────────────┐  │
                                │  │  MongoDB            │  │
                                │  │  • DepositRequests  │  │
                                │  │  • Wallets          │  │
                                │  │  • Transactions     │  │
                                │  └────────────────────┘  │
                                └──────────────────────────┘
                                            │
                                ┌───────────▼───────────┐
                                │  Admin Dashboard UI   │
                                │  (superadmin frontend) │
                                └───────────────────────┘
```

### 3.2 Tech Stack

| Layer        | Technology                                      |
|--------------|--------------------------------------------------|
| Backend      | Node.js, Express                                 |
| Database     | MongoDB (Mongoose)                               |
| Auth         | JWT (superadmin login)                           |
| Wallet Infra | Privy Server-Side SDK (`@privy-io/node`)         |
| Chains       | Ethereum (EIP-155:1), Arbitrum (EIP-155:42161)   |
| Tokens       | USDT, USDC (ERC-20 on both chains)               |
| Frontend     | To be determined (React recommended)             |
| Deployment   | Render                                           |

---

## 4. Wallet Architecture (Privy)

### 4.1 Treasury Wallets (Server-Controlled)

Treasury wallets are created and fully controlled by the admin service via **Privy authorization keys** (no user-in-the-loop required). This is the most secure server-side pattern.

| Wallet Purpose      | Chain      | Tokens Held       | Role                                           |
|---------------------|------------|-------------------|-------------------------------------------------|
| **Receive Wallet**  | Ethereum   | USDT, USDC        | Accepts stablecoin deposits from end users      |
| **Receive Wallet**  | Solana     | USDT (optional)   | Accepts stablecoin deposits from end users      |
| **Disburse Wallet** | Arbitrum   | USDC (primary)    | Auto-sends tokens to user spot wallets          |
| **Disburse Wallet** | Arbitrum   | USDT              | Sends USDT when specifically requested          |

#### Privy Setup

1. **Create an App Authorization Key** — generate a key pair; register the public key with Privy; store the private key securely in env (`PRIVY_AUTHORIZATION_PRIVATE_KEY`).
2. **Create Treasury Wallets** — use `client.wallets().create()` with the authorization key as the owner. One wallet per chain per purpose.
3. **Execute Transactions** — use `client.wallets().ethereum.sendTransaction()` signed automatically by the authorization key. No user key required.

### 4.2 Wallet Data Model

```
Wallet {
  _id              ObjectId
  privyWalletId    String       // Privy wallet ID
  address          String       // On-chain address
  chain            String       // "ethereum" | "arbitrum" | "solana"
  chainId          String       // CAIP-2 identifier (e.g., "eip155:42161")
  purpose          String       // "receive" | "disburse"
  tokens           [String]     // ["USDC", "USDT"]
  label            String       // Human-readable label
  isActive         Boolean
  createdAt        Date
  updatedAt        Date
}
```

---

## 5. Deposit Request Lifecycle

### 5.1 Flow

```
User (Dashboard)                  Admin Service                    Blockchain
     │                                 │                               │
     │  1. Request deposit             │                               │
     │  (wallet, chain, amount, token) │                               │
     │────────────────────────────────▶│                               │
     │                                 │  2. Create DepositRequest     │
     │  3. Return treasury address     │     status: "pending"         │
     │◀────────────────────────────────│                               │
     │                                 │                               │
     │  4. User sends stablecoin       │                               │
     │     to treasury receive wallet  │                               │
     │─────────────────────────────────────────────────────────────────▶
     │                                 │                               │
     │                                 │  5. Detect incoming deposit   │
     │                                 │     (webhook / polling)       │
     │                                 │◀──────────────────────────────│
     │                                 │                               │
     │                                 │  6. Verify amount matches     │
     │                                 │     Update status: "verified" │
     │                                 │                               │
     │                                 │  7. Auto-send USDC (ARB)      │
     │                                 │     to user spot wallet       │
     │                                 │──────────────────────────────▶│
     │                                 │                               │
     │                                 │  8. Record tx hash            │
     │                                 │     Update status: "completed"│
     │                                 │                               │
     │  9. Notify user                 │                               │
     │◀────────────────────────────────│                               │
```

### 5.2 Deposit Request States

| Status         | Description                                                    |
|----------------|----------------------------------------------------------------|
| `pending`      | Request created; awaiting user's stablecoin transfer           |
| `verified`     | Incoming deposit detected and amount confirmed                 |
| `processing`   | Auto-disbursement transaction submitted to chain               |
| `completed`    | Tokens sent to user spot wallet; tx hash recorded              |
| `failed`       | Disbursement failed (insufficient funds, tx error, etc.)       |
| `expired`      | User did not send deposit within the allowed time window       |
| `rejected`     | Admin manually rejected the request                            |

### 5.3 Deposit Request Data Model

```
DepositRequest {
  _id                 ObjectId
  userId              String          // External user ID (from dashboard)
  userWalletAddress   String          // User's spot wallet address (destination)
  chain               String          // Target chain for disbursement ("arbitrum")
  requestedToken      String          // Token user wants ("USDC" | "USDT")
  requestedAmount     Number          // Amount in token units (e.g., 100.00)
  
  depositChain        String          // Chain user deposits on ("ethereum" | "solana")
  depositToken        String          // Token user deposits ("USDT" | "USDC")
  depositAmount       Number          // Amount user should deposit
  depositTxHash       String | null   // User's incoming tx hash (once detected)
  
  treasuryWalletId    ObjectId        // Receive wallet that should get the deposit
  
  disburseTxHash      String | null   // Outgoing tx hash (admin → user)
  disburseWalletId    ObjectId | null // Disburse wallet used
  
  status              String          // See states above
  description         String          // Brief description from user
  adminNotes          String          // Internal notes by admin
  
  expiresAt           Date            // Auto-expire if no deposit received
  verifiedAt          Date | null
  completedAt         Date | null
  createdAt           Date
  updatedAt           Date
}
```

---

## 6. API Endpoints

### 6.1 Auth

| Method | Route                   | Auth   | Description                |
|--------|-------------------------|--------|----------------------------|
| POST   | `/api/admin/login`      | Public | Superadmin JWT login       |

### 6.2 Treasury Wallets

| Method | Route                          | Auth | Description                           |
|--------|--------------------------------|------|---------------------------------------|
| POST   | `/api/wallets`                 | JWT  | Create a new treasury wallet (Privy)  |
| GET    | `/api/wallets`                 | JWT  | List all treasury wallets             |
| GET    | `/api/wallets/:id`             | JWT  | Get wallet details + balances         |
| GET    | `/api/wallets/:id/balance`     | JWT  | Fetch live on-chain token balances    |
| PATCH  | `/api/wallets/:id`             | JWT  | Update wallet label / active status   |

### 6.3 Deposit Requests

| Method | Route                                    | Auth    | Description                                    |
|--------|------------------------------------------|---------|------------------------------------------------|
| POST   | `/api/deposits`                          | API Key | Create deposit request (from dashboard)        |
| GET    | `/api/deposits`                          | JWT     | List all deposit requests (filterable)         |
| GET    | `/api/deposits/:id`                      | JWT     | Get single deposit request details             |
| GET    | `/api/deposits/stats`                    | JWT     | Aggregate stats (counts by status, volume)     |
| PATCH  | `/api/deposits/:id/verify`               | JWT     | Manually verify a deposit                      |
| PATCH  | `/api/deposits/:id/approve`              | JWT     | Approve & trigger auto-disbursement            |
| PATCH  | `/api/deposits/:id/reject`               | JWT     | Reject a deposit request                       |

### 6.4 Transactions

| Method | Route                          | Auth | Description                              |
|--------|--------------------------------|------|------------------------------------------|
| GET    | `/api/transactions`            | JWT  | List all outgoing transactions           |
| GET    | `/api/transactions/:id`        | JWT  | Get transaction details + chain status   |

### 6.5 Dashboard

| Method | Route                          | Auth | Description                              |
|--------|--------------------------------|------|------------------------------------------|
| GET    | `/api/dashboard/overview`      | JWT  | Summary: wallet balances, pending count, recent activity |

---

## 7. Disbursement Logic (Auto-Send)

When a deposit is verified:

1. **Check disburse wallet balance** — ensure the Arbitrum disburse wallet has enough USDC (or requested token).
2. **Build ERC-20 transfer transaction** — `transfer(userWalletAddress, amount)` on the USDC/USDT contract.
3. **Send via Privy** — `client.wallets().ethereum.sendTransaction(walletId, { caip2: 'eip155:42161', transaction: { to, data } })`.
4. **Record tx hash** — update `DepositRequest.disburseTxHash` and status to `processing`.
5. **Confirm on-chain** — poll or use webhook to confirm finality → status to `completed`.
6. **Handle failure** — if tx fails, set status to `failed`, alert admin via dashboard.

### Token Contract Addresses

| Token | Chain    | Contract Address                             |
|-------|----------|----------------------------------------------|
| USDC  | Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| USDT  | Arbitrum | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` |
| USDC  | Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| USDT  | Ethereum | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |

---

## 8. Security

| Concern                  | Mitigation                                                                 |
|--------------------------|----------------------------------------------------------------------------|
| Treasury key custody     | Privy authorization key (private key in env, never exposed)                |
| Admin access             | JWT auth, bcrypt-hashed passwords, rate limiting                           |
| API from dashboard       | API key authentication for deposit creation endpoint                       |
| Transaction limits       | Privy policies: max transfer amount per tx, allowlisted recipient check    |
| Input validation         | Joi schemas on all endpoints                                               |
| Transport                | HTTPS only, Helmet headers, CORS restricted to known origins               |
| Deposit verification     | Match on-chain tx amount/sender before disbursing                          |
| Double-spend prevention  | Unique constraint on `depositTxHash`; idempotent disbursement              |
| Monitoring               | Log all wallet actions; dashboard alerts for failed tx / low balance       |

---

## 9. Environment Variables

```env
# Server
NODE_ENV=production
PORT=3000
MONGO_URI=mongodb+srv://...
JWT_SECRET=<strong-random-secret>
CORS_ORIGIN=https://admin.worldstreet.io

# Privy
PRIVY_APP_ID=<privy-app-id>
PRIVY_APP_SECRET=<privy-app-secret>
PRIVY_AUTHORIZATION_PRIVATE_KEY=<pem-encoded-private-key>

# Dashboard API Key (for deposit creation from user-facing app)
DASHBOARD_API_KEY=<strong-random-key>

# RPC (optional overrides)
ETHEREUM_RPC_URL=https://mainnet.infura.io/v3/<key>
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc

# Token Contracts (Arbitrum)
USDC_ARB_CONTRACT=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
USDT_ARB_CONTRACT=0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9
```

---

## 10. Data Models Summary

### User (existing)
Superadmin authentication only. Already created in setup phase.

### Wallet
Treasury wallets managed via Privy. Stored locally for reference, labeling, and mapping.

### DepositRequest
Full lifecycle of a user's spot-wallet funding request.

### Transaction
Record of every outgoing disbursement from treasury wallets.

```
Transaction {
  _id              ObjectId
  depositRequestId ObjectId        // Link to deposit request
  walletId         ObjectId        // Disburse wallet used
  chain            String          // "arbitrum"
  token            String          // "USDC"
  amount           Number
  toAddress        String          // User's spot wallet
  txHash           String
  status           String          // "submitted" | "confirmed" | "failed"
  blockNumber      Number | null
  gasUsed          String | null
  createdAt        Date
  updatedAt        Date
}
```

---

## 11. Dashboard Views (Frontend)

### 11.1 Overview Page
- Total treasury balance (per wallet, per token)
- Pending deposit request count
- Today's disbursement volume
- Recent activity feed

### 11.2 Wallets Page
- List of all treasury wallets with live balances
- Create new wallet button
- Wallet detail: address, chain, balance breakdown, transaction history

### 11.3 Deposit Requests Page
- Filterable table: status, chain, date range, amount
- Row actions: verify, approve, reject
- Detail view: full request info, linked transactions, timeline

### 11.4 Transactions Page
- All outgoing disbursement transactions
- Status, tx hash (linked to block explorer), amount, timestamp

---

## 12. Future Considerations (Out of Scope for v1)

- **Solana receive wallet** for SOL/USDT deposits (architecture supports it, not in v1 launch)
- **Webhook-based deposit detection** (Privy deposit webhooks for automatic verification)
- **Multi-role access** (operator, viewer roles)
- **User management** within this service
- **Bridge automation** (auto-bridge received ETH USDT → ARB USDC)
- **Notifications** (email/Telegram alerts for admin on new deposits, low balance)
- **Audit log** for all admin actions

---

## 13. Folder Structure (Updated)

```
project-root/
├── src/
│   ├── config/
│   │   ├── index.js
│   │   ├── db.js
│   │   └── privy.js              # Privy client initialization
│   ├── models/
│   │   ├── User.js
│   │   ├── Wallet.js
│   │   ├── DepositRequest.js
│   │   └── Transaction.js
│   ├── controllers/
│   │   ├── adminController.js
│   │   ├── walletController.js
│   │   ├── depositController.js
│   │   ├── transactionController.js
│   │   └── dashboardController.js
│   ├── routes/
│   │   ├── adminRoutes.js
│   │   ├── walletRoutes.js
│   │   ├── depositRoutes.js
│   │   ├── transactionRoutes.js
│   │   └── dashboardRoutes.js
│   ├── services/
│   │   ├── authService.js
│   │   ├── walletService.js       # Privy wallet create/query
│   │   ├── disbursementService.js  # Auto-send logic
│   │   └── balanceService.js       # On-chain balance checks
│   ├── middlewares/
│   │   ├── authMiddleware.js       # JWT for admin
│   │   ├── apiKeyMiddleware.js     # API key for dashboard
│   │   └── validateMiddleware.js
│   ├── utils/
│   │   ├── errorHandler.js
│   │   ├── validationSchemas.js
│   │   └── constants.js            # Token addresses, chain IDs
│   └── app.js
├── .env.example
├── package.json
├── PRD.md
└── README.md
```

---

## 14. Acceptance Criteria (v1)

- [ ] Superadmin can log in and access the dashboard
- [ ] Superadmin can create treasury wallets on Ethereum and Arbitrum via Privy
- [ ] Treasury wallet balances are displayed in real-time
- [ ] Deposit requests can be created via API (from external dashboard)
- [ ] Deposit requests appear in the admin dashboard with all details
- [ ] Admin can verify a deposit (match on-chain tx)
- [ ] Upon approval, USDC (Arbitrum) is automatically sent to the user's spot wallet
- [ ] Transaction hash is recorded and status tracked to confirmation
- [ ] Failed disbursements are flagged and visible in the dashboard
- [ ] All endpoints are secured (JWT for admin, API key for dashboard integration)
