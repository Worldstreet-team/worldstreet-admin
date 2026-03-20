# Worldstreet Admin API — Integration Guide

## Overview

The Worldstreet Admin service is the treasury backbone for the Worldstreet trading platform. It manages multi-chain treasury wallets (Ethereum, Arbitrum, Solana, TRON), processes deposit requests from the user-facing dashboard, and automatically disburses tokens to user wallets upon verification. It also watches on-chain activity to auto-match and disburse deposits without manual admin intervention.

**Base URL:** `http://your-host:PORT/api`

---

## Authentication

The API uses two authentication mechanisms depending on the caller.

### 1. JWT (Admin Panel)

Admin endpoints require a Bearer token obtained by logging in.

```
POST /api/admin/login
```

**Body:**
```json
{
  "username": "superadmin",
  "password": "yourpassword"
}
```

**Response:**
```json
{
  "token": "eyJhbGci..."
}
```

Include the token in all subsequent admin requests:
```
Authorization: Bearer <token>
```

---

### 2. API Key (External Dashboard)

The user-facing dashboard creates deposit requests and polls their status using an API key.

Include the key in every request:
```
x-api-key: <DASHBOARD_API_KEY>
```

The `DASHBOARD_API_KEY` is set in the `.env` file.

---

## Deposit Flow

This is the primary integration point between the user dashboard and the admin service.

```
Dashboard                       Admin Service                     Blockchain
   │                                  │                               │
   │  POST /api/deposits               │                               │
   │ ─────────────────────────────►   │                               │
   │  ◄─ { deposit, treasuryAddress } │                               │
   │                                  │                               │
   │  [User sends tokens on-chain ──────────────────────────────────► ]
   │                                  │                               │
   │  GET /api/deposits/status/:id    │                               │
   │ ─────────────────────────────►   │                               │
   │  ◄─ { status: "pending" }        │                               │
   │                                  │                               │
   │              [Auto-watcher detects deposit & triggers disburse]  │
   │                                  │                               │
   │  GET /api/deposits/status/:id    │                               │
   │ ─────────────────────────────►   │                               │
   │  ◄─ { status: "completed" }      │                               │
```

### Step 1 — Create a Deposit Request

```
POST /api/deposits
x-api-key: <DASHBOARD_API_KEY>
```

**Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | string | ✅ | Your platform's user identifier |
| `userWalletAddress` | string | ✅ | User's wallet address to receive disbursement |
| `walletType` | string | ✅ | `"spot"` or `"futures"` |
| `requestedToken` | string | ✅ | Token to credit on the platform: `"USDC"` or `"USDT"` |
| `requestedAmount` | number | ✅ | Amount to credit to the user |
| `depositChain` | string | ✅ | Chain the user will send from: `"ethereum"`, `"arbitrum"`, `"solana"`, `"tron"` |
| `depositToken` | string | ✅ | Token the user will send: `"USDC"` or `"USDT"` |
| `depositAmount` | number | ✅ | Amount the user will send |
| `chain` | string | ❌ | Chain for disbursement (default: `"arbitrum"`). Use `"tron"` to disburse to a TRON address. |
| `depositFromAddress` | string | ❌ | User's sending address (enables auto-matching) |
| `description` | string | ❌ | Optional note (max 500 chars) |

**Response `201`:**
```json
{
  "deposit": {
    "_id": "66a1b2c3...",
    "status": "pending",
    "expiresAt": "2026-03-16T12:00:00.000Z",
    ...
  },
  "treasuryAddress": "0xABCD...",
  "treasuryChain": "arbitrum"
}
```

Store the `deposit._id` and show the user `treasuryAddress` to send funds to.

---

### Step 2 — User Sends Funds

Direct the user to send exactly `depositAmount` of `depositToken` to `treasuryAddress` on `depositChain`. The deposit expires in **24 hours**.

---

### Step 3 — Poll Deposit Status

```
GET /api/deposits/status/:id
x-api-key: <DASHBOARD_API_KEY>
```

**Response:**
```json
{
  "_id": "66a1b2c3...",
  "status": "pending",
  "depositTxHash": null,
  "disburseTxHash": null,
  ...
}
```

Poll this endpoint until `status` is `"completed"` or `"rejected"`. Recommended interval: every 15–30 seconds.

**Deposit Statuses:**
| Status | Meaning |
|---|---|
| `pending` | Awaiting on-chain transfer |
| `verified` | On-chain transfer confirmed by admin or auto-watcher |
| `processing` | Disbursement transaction being sent |
| `completed` | Tokens sent to user wallet |
| `failed` | Disbursement failed |
| `rejected` | Rejected by admin |
| `expired` | 24-hour window elapsed without payment |

---

## Admin Endpoints

All admin endpoints require `Authorization: Bearer <token>`.

### Authentication

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/login` | Login and receive JWT |

---

### Wallets

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/wallets` | Create a treasury wallet |
| `GET` | `/api/wallets` | List all wallets |
| `GET` | `/api/wallets/:id` | Get wallet details |
| `GET` | `/api/wallets/:id/balance` | Get wallet balances |
| `PATCH` | `/api/wallets/:id` | Update label or active status |
| `POST` | `/api/wallets/:id/send` | Manually send tokens from wallet |

#### Create Wallet — `POST /api/wallets`

```json
{
  "chain": "arbitrum",
  "purpose": "receive",
  "tokens": ["USDC", "USDT"],
  "label": "ARB Receive 1"
}
```

- `chain`: `"ethereum"` | `"arbitrum"` | `"solana"` | `"tron"`
- `purpose`: `"receive"` | `"disburse"` | `"fees"`

> **TRON wallets** — ensure Tier 2 / extended chains are enabled in your Privy dashboard before creating TRON wallets. TRON addresses use Base58 format (`T...`, 34 characters).

#### Get Wallet Balance — `GET /api/wallets/:id/balance`

Optional query parameter to include native coin USD value:
```
GET /api/wallets/:id/balance?includeFiatValues=true
```

**Response:**
```json
{
  "walletId": "...",
  "address": "0xABCD...",
  "chain": "arbitrum",
  "balances": {
    "native": "0.05",
    "nativeUsd": 170.50,
    "nativeCoinPrice": 3410.00,
    "USDC": "1500.00",
    "USDT": "0.00"
  }
}
```

Without `?includeFiatValues=true`, `nativeUsd` and `nativeCoinPrice` are omitted.

#### Send Tokens — `POST /api/wallets/:id/send`

```json
{
  "toAddress": "0x1234...",
  "token": "USDC",
  "amount": "100.00"
}
```

- `token`: `"USDC"` | `"USDT"` | `"native"`
- `amount`: string to preserve decimal precision

---

### Deposits

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/deposits` | API Key | Create deposit (dashboard) |
| `GET` | `/api/deposits/status/:id` | API Key | Poll deposit status (dashboard) |
| `GET` | `/api/deposits` | JWT | List all deposits |
| `GET` | `/api/deposits/stats` | JWT | Aggregate stats |
| `GET` | `/api/deposits/:id` | JWT | Get single deposit |
| `PATCH` | `/api/deposits/:id/verify` | JWT | Manually verify with tx hash |
| `PATCH` | `/api/deposits/:id/approve` | JWT | Approve + trigger disbursement |
| `PATCH` | `/api/deposits/:id/reject` | JWT | Reject deposit |

#### List Deposits — `GET /api/deposits`

Query filters:
```
?status=pending&userId=abc&chain=tron&walletType=spot&page=1&limit=20
```

Supported `chain` values: `ethereum`, `arbitrum`, `solana`, `tron`

#### Manually Verify — `PATCH /api/deposits/:id/verify`

```json
{
  "depositTxHash": "0xabc123..."
}
```

#### Reject Deposit — `PATCH /api/deposits/:id/reject`

```json
{
  "adminNotes": "Duplicate submission"
}
```

---

### Transactions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/transactions` | List all outbound transactions |
| `GET` | `/api/transactions/:id` | Get single transaction |

Query filters for list: `?chain=arbitrum&token=USDC&status=confirmed`

---

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard/overview` | Wallet balances, deposit stats, recent activity |

Optional:
```
GET /api/dashboard/overview?includeFiatValues=true
```

---

## Automatic Deposit Watcher

The service runs a background job that polls on-chain activity against all active `receive` wallets. When a matching inbound transfer is detected:

1. A pending `DepositRequest` is matched by `depositFromAddress`, `depositAmount`, and `depositToken`.
2. The deposit is automatically verified.
3. Disbursement is triggered immediately to the user's wallet.

**No manual admin action is needed** when `depositFromAddress` is provided at deposit creation time.

If `depositFromAddress` is omitted, the deposit will not be auto-matched and must be manually verified via `PATCH /api/deposits/:id/verify`.

---

## Supported Chains & Tokens

| Chain | Native Coin | USDC Contract | USDT Contract |
|---|---|---|---|
| Ethereum | ETH | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| Arbitrum | ETH | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` |
| Solana | SOL | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| TRON | TRX | `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8` | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |

### TRON Address Format

TRON addresses are Base58Check-encoded and always start with `T` (34 characters), e.g. `TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE`. Do **not** pass EVM (`0x`) addresses for TRON fields.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MONGO_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | Secret for signing JWTs |
| `PRIVY_APP_ID` | ✅ | Privy application ID |
| `PRIVY_APP_SECRET` | ✅ | Privy application secret |
| `PRIVY_AUTHORIZATION_PRIVATE_KEY` | ✅ | Privy wallet authorization key |
| `DASHBOARD_API_KEY` | ✅ | API key for the user-facing dashboard |
| `PORT` | ❌ | HTTP port (default: `3000`) |
| `CORS_ORIGIN` | ❌ | Allowed CORS origin (default: `http://localhost:3000`) |
| `ETHEREUM_RPC_URL` | ❌ | Ethereum JSON-RPC endpoint |
| `ARBITRUM_RPC_URL` | ❌ | Arbitrum JSON-RPC endpoint |
| `SOLANA_RPC_URL` | ❌ | Solana RPC endpoint |
| `TRON_RPC_URL` | ❌ | TRON full-node / TronGrid endpoint (default: `https://api.trongrid.io`) |
| `TRON_API_KEY` | ❌ | TronGrid API key sent as `TRON-PRO-API-KEY` header (not needed if key is embedded in the URL) |
| `USDC_TRON_CONTRACT` | ❌ | Override USDC TRC-20 contract address on TRON |
| `USDT_TRON_CONTRACT` | ❌ | Override USDT TRC-20 contract address on TRON |
| `AUTO_DISBURSE_ENABLED` | ❌ | Set to `"false"` to disable auto-watcher (default: `true`) |
| `POLL_INTERVAL_SECONDS` | ❌ | Watcher poll frequency in seconds (default: `30`) |
| `REQUIRED_CONFIRMATIONS_ETH` | ❌ | EVM confirmations before matching (default: `12`) |

---

## Error Responses

All errors follow the shape:

```json
{
  "message": "Human-readable description"
}
```

Common HTTP status codes:

| Code | Meaning |
|---|---|
| `400` | Validation error or bad request |
| `401` | Missing or invalid credentials |
| `403` | Forbidden |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate tx hash) |
| `429` | Rate limit exceeded (100 req / 15 min) |
| `500` | Internal server error |

---

## Quick Start Example (Dashboard Integration)

### EVM / Arbitrum

```js
const BASE = 'https://your-admin-service.com/api';
const API_KEY = 'dapikey';

// 1. Create a deposit request
const { deposit, treasuryAddress } = await fetch(`${BASE}/deposits`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
  body: JSON.stringify({
    userId: 'user_abc123',
    userWalletAddress: '0xUserWallet...',
    walletType: 'spot',
    requestedToken: 'USDC',
    requestedAmount: 100,
    depositChain: 'arbitrum',
    depositToken: 'USDC',
    depositAmount: 100,
    depositFromAddress: '0xUserSendingWallet...',
  }),
}).then(r => r.json());

// 2. Show user: send 100 USDC on Arbitrum to `treasuryAddress`

// 3. Poll status
const poll = setInterval(async () => {
  const d = await fetch(`${BASE}/deposits/status/${deposit._id}`, {
    headers: { 'x-api-key': API_KEY },
  }).then(r => r.json());

  if (d.status === 'completed') {
    clearInterval(poll);
    console.log('Deposit completed, disburseTxHash:', d.disburseTxHash);
  } else if (['rejected', 'expired', 'failed'].includes(d.status)) {
    clearInterval(poll);
    console.log('Deposit ended with status:', d.status);
  }
}, 15_000);
```

---

## TRON Integration

### TRON Wallet Setup (Admin)

Before accepting TRON deposits you need at least one `receive` wallet and one `disburse` wallet on TRON.

```http
POST /api/wallets
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "chain": "tron",
  "purpose": "receive",
  "label": "TRON Receive 1"
}
```

```http
POST /api/wallets
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "chain": "tron",
  "purpose": "disburse",
  "label": "TRON Disburse 1"
}
```

> The `disburse` wallet needs a small amount of TRX to cover energy/bandwidth fees on TRC-20 transfers (~10–20 TRX per transaction). Fund it manually before enabling auto-disburse.

---

### TRON Deposit Flow (Dashboard)

```js
// 1. Create a TRON deposit request
//    - depositChain: 'tron'   — user will send USDT via TRC-20
//    - chain: 'tron'          — disbursement goes to a TRON address
//    - depositFromAddress     — user's TRON wallet (T-prefixed, 34 chars)
//    - userWalletAddress      — user's TRON wallet to receive disbursement

const { deposit, treasuryAddress, treasuryChain } = await fetch(`${BASE}/deposits`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
  body: JSON.stringify({
    userId: 'user_abc123',
    userWalletAddress: 'TUserReceiveWallet...',   // TRON address (T...)
    walletType: 'spot',
    requestedToken: 'USDT',
    requestedAmount: 100,
    depositChain: 'tron',
    depositToken: 'USDT',
    depositAmount: 100,
    chain: 'tron',                                // disburse on TRON too
    depositFromAddress: 'TUserSendingWallet...',  // enables auto-matching
  }),
}).then(r => r.json());

// treasuryAddress will be a T... TRON address
// treasuryChain will be 'tron'

// 2. Instruct the user to send exactly 100 USDT (TRC-20) to treasuryAddress

// 3. Poll status — same as other chains
const poll = setInterval(async () => {
  const d = await fetch(`${BASE}/deposits/status/${deposit._id}`, {
    headers: { 'x-api-key': API_KEY },
  }).then(r => r.json());

  if (d.status === 'completed') {
    clearInterval(poll);
    console.log('TRON deposit completed, tx:', d.disburseTxHash);
  } else if (['rejected', 'expired', 'failed'].includes(d.status)) {
    clearInterval(poll);
  }
}, 15_000);
```

---

### Cross-chain: User deposits on TRON, receives on Arbitrum

You can accept TRON deposits and disburse on a different chain:

```json
{
  "userId": "user_abc123",
  "userWalletAddress": "0xUserArbitrumWallet...",
  "walletType": "spot",
  "requestedToken": "USDC",
  "requestedAmount": 100,
  "depositChain": "tron",
  "depositToken": "USDT",
  "depositAmount": 100,
  "chain": "arbitrum",
  "depositFromAddress": "TUserSendingWallet..."
}
```

`treasuryAddress` will be a TRON receive address. The user sends USDT on TRC-20. Once detected, the service disburses USDC on Arbitrum to `userWalletAddress`.

---

### TRON Auto-Watcher Notes

- The watcher polls `${TRON_RPC_URL}/v1/accounts/{address}/transactions/trc20` every `POLL_INTERVAL_SECONDS` seconds.
- Only **incoming** TRC-20 transfers (USDC or USDT) to `receive` wallets are processed.
- The cursor tracks `block_timestamp` to avoid re-processing. On first run it looks back **30 minutes**.
- Provide `depositFromAddress` at deposit creation for fully automatic matching. Without it, a manual verify step is required (`PATCH /api/deposits/:id/verify`).
- The Alchemy TRON endpoint (`https://tron-mainnet.g.alchemy.com/v2/<key>`) is fully compatible — no separate `TRON_API_KEY` header is needed since the key is embedded in the URL.

---

### TRON Wallet Balance

```http
GET /api/wallets/:id/balance?includeFiatValues=true
```

For a TRON wallet the response looks like:

```json
{
  "walletId": "...",
  "address": "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
  "chain": "tron",
  "balances": {
    "native": "42.5",
    "nativeUsd": 10.54,
    "nativeCoinPrice": 0.248,
    "USDC": "0.00",
    "USDT": "1500.00"
  }
}
```

`native` is the TRX balance (in TRX, not SUN).

---

### Manual Send from TRON Wallet

```http
POST /api/wallets/:id/send
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "toAddress": "TRecipient...",
  "token": "USDT",
  "amount": "50.00"
}
```

For native TRX:

```json
{
  "toAddress": "TRecipient...",
  "token": "native",
  "amount": "10.00"
}
```
