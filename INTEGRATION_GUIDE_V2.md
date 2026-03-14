# WorldStreet Admin — Dashboard API Integration Guide v2

**Base URL:** `http://localhost:3000` (dev) · `https://your-render-url.com` (prod)

> **What's new in v2:** Solana chain support (receive + disburse SPL tokens), `fees` wallet purpose for holding native gas tokens, and a new `POST /api/wallets/:id/send` endpoint for direct treasury-to-any-address transfers. See [§ What Changed from v1](#what-changed-from-v1) for a full diff.

---

## Table of Contents

1. [What Changed from v1](#1-what-changed-from-v1)
2. [Authentication Flow](#2-authentication-flow)
3. [Dashboard Overview Flow](#3-dashboard-overview-flow)
4. [Treasury Wallet Management Flow](#4-treasury-wallet-management-flow)
5. [Send from Wallet Flow (NEW)](#5-send-from-wallet-flow-new)
6. [Deposit Request Lifecycle Flow](#6-deposit-request-lifecycle-flow)
7. [Transaction Monitoring Flow](#7-transaction-monitoring-flow)
8. [API Reference](#8-api-reference)
9. [Error Handling](#9-error-handling)
10. [Constants & Enums](#10-constants--enums)

---

## 1. What Changed from v1

### New: Solana Chain Support

The system now supports **Solana** as a full first-class chain alongside Ethereum and Arbitrum.

| Area | v1 | v2 |
|---|---|---|
| Supported chains | `ethereum`, `arbitrum` | `ethereum`, `arbitrum`, **`solana`** |
| Wallet creation | EVM only | EVM + Solana (Privy `chain_type: 'solana'`) |
| Balance checking | ETH + ERC-20 | ETH + ERC-20 + **SOL + SPL tokens** |
| Disbursement | ERC-20 transfer only | ERC-20 + **SPL token transfer** |
| Deposit `depositChain` | `ethereum` \| `arbitrum` | `ethereum` \| `arbitrum` \| **`solana`** |
| Deposit `userWalletAddress` | EVM `0x` only | EVM `0x` + **Solana base58** |
| `chain` field in all requests | 2 options | 3 options |
| Block explorer link | Etherscan / Arbiscan | Etherscan / Arbiscan / **Solscan** |

### New: `fees` Wallet Purpose

A new wallet purpose `fees` was added so the admin can hold native gas tokens (ETH on Ethereum/Arbitrum, SOL on Solana) in dedicated fee wallets separate from receive/disburse wallets.

| Purpose | v1 | v2 |
|---|---|---|
| `receive` | ✓ | ✓ |
| `disburse` | ✓ | ✓ |
| `fees` | ✗ | ✓ **NEW** |

Fee wallets are funded manually by transferring native tokens from an external wallet to the treasury address. They are created via the standard `POST /api/wallets` endpoint.

### New: Send from Wallet Endpoint

`POST /api/wallets/:id/send` — allows the admin to send **any token** (USDC, USDT, or native ETH/SOL) from any treasury wallet to any external address. Sends are recorded in the Transaction model with `type: "manual-send"`.

### Changed: Transaction Model

| Field | v1 | v2 |
|---|---|---|
| `depositRequestId` | Required | Optional (`null` for manual sends) |
| `token` | Enum: `USDC` \| `USDT` | Free string — also accepts `"native"` |
| `type` | Not present | **NEW** `"disbursement"` \| `"manual-send"` |

### Changed: `.env` Variables

| Variable | v1 | v2 |
|---|---|---|
| `SOLONA_RPC_URL` (typo) | Present (typo) | **Renamed** → `SOLANA_RPC_URL` |
| `USDC_SOL_CONTRACT` | Not present | **NEW** |
| `USDT_SOL_CONTRACT` | Not present | **NEW** |

---

## 2. Authentication Flow

Unchanged from v1. All protected endpoints require a JWT in the `Authorization` header.

```http
POST /api/admin/login
Content-Type: application/json

{
  "username": "superadmin",
  "password": "yourpassword"
}
```

**Response (200):**
```json
{ "token": "eyJhbGciOiJIUzI1NiIs..." }
```

Add to every protected request:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

> Token expires in **1 hour**. On `401` or `403`, redirect to login.

---

## 3. Dashboard Overview Flow

Unchanged from v1. The overview now naturally includes Solana wallet data when those wallets exist.

```http
GET /api/dashboard/overview
Authorization: Bearer <token>
```

**Response:**
```json
{
  "walletBalances": [
    {
      "id": "665a...",
      "label": "receive-ethereum",
      "address": "0xABC...",
      "chain": "ethereum",
      "purpose": "receive",
      "balances": { "native": "0.15", "USDC": "5200.00", "USDT": "3100.50" }
    },
    {
      "id": "667b...",
      "label": "receive-solana",
      "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "chain": "solana",
      "purpose": "receive",
      "balances": { "native": "1.500", "USDC": "8200.00", "USDT": "0" }
    }
  ],
  "statusCounts": [...],
  "pendingCount": 12,
  "todayVolume": [...],
  "recentActivity": [...]
}
```

---

## 4. Treasury Wallet Management Flow

### Recommended Setup (v2 — Updated)

Create these wallets after first login:

| # | Chain | Purpose | Tokens | Label |
|---|---|---|---|---|
| 1 | `ethereum` | `receive` | `["USDC", "USDT"]` | Main ETH Receive |
| 2 | `arbitrum` | `disburse` | `["USDC", "USDT"]` | Main ARB Disburse |
| 3 | `solana` | `receive` | `["USDC", "USDT"]` | **NEW** Main SOL Receive |
| 4 | `solana` | `disburse` | `["USDC", "USDT"]` | **NEW** Main SOL Disburse |
| 5 | `ethereum` | `fees` | `[]` | **NEW** ETH Fee Wallet |
| 6 | `arbitrum` | `fees` | `[]` | **NEW** ARB Fee Wallet |
| 7 | `solana` | `fees` | `[]` | **NEW** SOL Fee Wallet |

> **Fee wallets** hold only native tokens (ETH or SOL) for gas. Tokens array should be empty `[]`. Fund them by sending ETH/SOL from an external wallet to the treasury address.

### Create Wallet

#### EVM wallet (Ethereum or Arbitrum) — same as v1

```http
POST /api/wallets
Authorization: Bearer <token>
Content-Type: application/json

{
  "chain": "arbitrum",
  "purpose": "disburse",
  "tokens": ["USDC", "USDT"],
  "label": "Main ARB Disburse"
}
```

#### Solana wallet — NEW

```http
POST /api/wallets
Authorization: Bearer <token>
Content-Type: application/json

{
  "chain": "solana",
  "purpose": "receive",
  "tokens": ["USDC", "USDT"],
  "label": "Main SOL Receive"
}
```

#### Fee wallet — NEW

```http
POST /api/wallets
Authorization: Bearer <token>
Content-Type: application/json

{
  "chain": "solana",
  "purpose": "fees",
  "tokens": [],
  "label": "SOL Fee Wallet"
}
```

**Response (201) — Solana wallet example:**
```json
{
  "_id": "667b...",
  "privyWalletId": "wallet_sol123",
  "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "chain": "solana",
  "chainId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "purpose": "receive",
  "tokens": ["USDC", "USDT"],
  "label": "Main SOL Receive",
  "isActive": true,
  "createdAt": "2026-03-14T...",
  "updatedAt": "2026-03-14T..."
}
```

> **Solana address format:** A base58 string (32–44 characters), e.g., `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`. This is different from EVM `0x...` addresses.

### List Wallets

```http
GET /api/wallets
GET /api/wallets?chain=solana
GET /api/wallets?purpose=fees
GET /api/wallets?isActive=true
Authorization: Bearer <token>
```

The `chain` filter now accepts `solana` in addition to `ethereum` and `arbitrum`.

### Get Live On-Chain Balance

```http
GET /api/wallets/:id/balance
Authorization: Bearer <token>
```

**Response — EVM wallet (unchanged):**
```json
{
  "walletId": "665a...",
  "address": "0xDEF...",
  "chain": "arbitrum",
  "balances": {
    "native": "0.0542",
    "USDC": "12500.00",
    "USDT": "8300.00"
  }
}
```

**Response — Solana wallet (NEW):**
```json
{
  "walletId": "667b...",
  "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "chain": "solana",
  "balances": {
    "native": "1.500",
    "USDC": "8200.00",
    "USDT": "0"
  }
}
```

> `native` on Solana = **SOL** balance. On Ethereum/Arbitrum = **ETH** balance.

### Update Wallet

Unchanged from v1.

```http
PATCH /api/wallets/:id
Authorization: Bearer <token>
Content-Type: application/json

{ "label": "Renamed Wallet", "isActive": false }
```

---

## 5. Send from Wallet Flow (NEW)

This is a new capability in v2. The admin can send **any token** from any treasury wallet to any external address directly from the dashboard.

```
┌───────────────────────────────────────────────────────────┐
│                    SEND FROM WALLET                        │
│                                                           │
│  Admin selects:                                           │
│    • Source wallet (any treasury wallet)                  │
│    • Token: USDC | USDT | native (ETH or SOL)            │
│    • Amount                                               │
│    • Destination address                                  │
│                                                           │
│  Server:                                                  │
│    • EVM chains → Privy ethereum.sendTransaction()        │
│    • Solana → Privy solana.signAndSendTransaction()       │
│    • Records tx with type: "manual-send"                  │
└───────────────────────────────────────────────────────────┘
```

### Send Endpoint

```http
POST /api/wallets/:id/send
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `toAddress` | string | ✓ | Destination. EVM: `0x...` (40 hex chars). Solana: base58 (32–44 chars) |
| `token` | string | ✓ | `"USDC"`, `"USDT"`, or `"native"` |
| `amount` | string | ✓ | Amount as a string to preserve decimal precision, e.g. `"100.50"` |

> **`token: "native"`** sends ETH on Ethereum/Arbitrum wallets, or SOL on Solana wallets.

#### Example — Send USDC from Arbitrum disburse wallet

```http
POST /api/wallets/665a.../send
Authorization: Bearer <token>
Content-Type: application/json

{
  "toAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "token": "USDC",
  "amount": "500.00"
}
```

#### Example — Send native ETH from fee wallet

```http
POST /api/wallets/665c.../send
Authorization: Bearer <token>
Content-Type: application/json

{
  "toAddress": "0x9abcdef0123456789abcdef0123456789abcdef01",
  "token": "native",
  "amount": "0.05"
}
```

#### Example — Send USDT from Solana wallet (NEW)

```http
POST /api/wallets/667b.../send
Authorization: Bearer <token>
Content-Type: application/json

{
  "toAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "token": "USDT",
  "amount": "250.00"
}
```

#### Example — Send native SOL from Solana fee wallet (NEW)

```http
POST /api/wallets/667f.../send
Authorization: Bearer <token>
Content-Type: application/json

{
  "toAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "token": "native",
  "amount": "0.5"
}
```

**Response (200):**
```json
{
  "tx": {
    "_id": "669a...",
    "walletId": "665a...",
    "chain": "arbitrum",
    "token": "USDC",
    "amount": 500,
    "toAddress": "0x1234...",
    "txHash": "0x9876abcd...",
    "type": "manual-send",
    "status": "submitted",
    "depositRequestId": null,
    "createdAt": "2026-03-14T..."
  },
  "wallet": {
    "_id": "665a...",
    "address": "0xDEF...",
    "chain": "arbitrum",
    "label": "Main ARB Disburse"
  }
}
```

**Errors:**

| Code | Reason |
|---|---|
| `400` | Missing or invalid fields — wrong address format for chain, bad token, zero amount |
| `404` | Wallet not found |
| `400` | Wallet is not active |
| `500` | Privy transaction failed (e.g. insufficient balance for gas) |

### Send Flow Diagram

```
Admin Dashboard              WorldStreet Admin API              Privy / Chain
       │                             │                               │
       │  POST /wallets/:id/send     │                               │
       │  { toAddress, token, amt }  │                               │
       │────────────────────────────▶│                               │
       │                             │  Look up wallet in DB         │
       │                             │  Determine chain type         │
       │                             │                               │
       │                             │  EVM chains:                  │
       │                             │  ethereum.sendTransaction()──▶│
       │                             │                               │  Broadcast tx
       │                             │  Solana:                      │
       │                             │  solana.signAndSendTx()──────▶│
       │                             │                               │
       │                             │◀──────────── tx hash ─────────│
       │                             │                               │
       │                             │  Record Transaction           │
       │                             │  type: "manual-send"          │
       │                             │                               │
       │◀────── { tx, wallet } ──────│                               │
```

---

## 6. Deposit Request Lifecycle Flow

### 6.1 Changes from v1

- `depositChain` now accepts `"solana"` in addition to `"ethereum"` and `"arbitrum"`
- `chain` (the chain to disburse on) now accepts `"solana"`
- `userWalletAddress` now accepts Solana base58 addresses as well as EVM `0x` addresses
- `depositTxHash` on the verify endpoint accepts Solana transaction signatures (base58, 87–88 chars) in addition to EVM tx hashes (`0x` + 64 hex)
- Disbursement now routes to SPL token transfer when `chain` is `"solana"`

### 6.2 State Machine

Unchanged from v1.

```
                  ┌──────────┐
    User sends    │          │   Admin rejects
    deposit req ─▶│ PENDING  │──────────────────▶ REJECTED
                  │          │
                  └────┬─────┘
                       │
                       │ No deposit within 24h
                       ├──────────────────────▶ EXPIRED
                       │
                       │ Admin verifies (tx hash)
                       ▼
                  ┌──────────┐
                  │ VERIFIED │
                  └────┬─────┘
                       │
                       │ Admin approves → auto-send triggered
                       ▼
                  ┌────────────┐
                  │ PROCESSING │
                  └────┬───────┘
                       │
              ┌────────┼────────┐
              ▼                 ▼
        ┌───────────┐    ┌──────────┐
        │ COMPLETED │    │  FAILED  │
        └───────────┘    └──────────┘
```

### 6.3 Create Deposit (API Key — external dashboard)

#### EVM deposit (unchanged)

```http
POST /api/deposits
x-api-key: <DASHBOARD_API_KEY>
Content-Type: application/json

{
  "userId": "user_abc123",
  "userWalletAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "chain": "arbitrum",
  "requestedToken": "USDC",
  "requestedAmount": 500,
  "depositChain": "ethereum",
  "depositToken": "USDT",
  "depositAmount": 500,
  "description": "Fund spot wallet"
}
```

#### Solana deposit — NEW

User wants to deposit USDT on Solana, receive USDC on Arbitrum:

```http
POST /api/deposits
x-api-key: <DASHBOARD_API_KEY>
Content-Type: application/json

{
  "userId": "user_abc123",
  "userWalletAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "chain": "arbitrum",
  "requestedToken": "USDC",
  "requestedAmount": 500,
  "depositChain": "solana",
  "depositToken": "USDT",
  "depositAmount": 500,
  "description": "Fund spot wallet via SOL"
}
```

User wants to disburse on Solana, with a Solana destination address:

```http
POST /api/deposits
x-api-key: <DASHBOARD_API_KEY>
Content-Type: application/json

{
  "userId": "user_abc123",
  "userWalletAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "chain": "solana",
  "requestedToken": "USDC",
  "requestedAmount": 500,
  "depositChain": "solana",
  "depositToken": "USDT",
  "depositAmount": 500,
  "description": "Fund SOL spot wallet"
}
```

**Response (201):**
```json
{
  "deposit": { "...full deposit object..." },
  "treasuryAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "treasuryChain": "solana"
}
```

> Show `treasuryAddress` to the user so they know where to send their stablecoin. For Solana deposits this will be a base58 address.

### 6.4 List Deposits

```http
GET /api/deposits?status=pending&page=1&limit=20
Authorization: Bearer <token>
```

`chain` filter now also accepts `solana`.

### 6.5 Verify Deposit

```http
PATCH /api/deposits/:id/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "depositTxHash": "<tx_hash_or_solana_signature>"
}
```

Pass the Solana transaction signature (base58, e.g. `5UfDuX3Wr8...`) for Solana deposits, or the EVM tx hash (`0xabcd...`) for EVM deposits.

### 6.6 Approve & Auto-Disburse

```http
PATCH /api/deposits/:id/approve
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "deposit": {
    "_id": "665a...",
    "status": "completed",
    "disburseTxHash": "0x9876...",
    "completedAt": "2026-03-14T11:00:00.000Z"
  },
  "transaction": {
    "_id": "665b...",
    "txHash": "0x9876...",
    "chain": "arbitrum",
    "token": "USDC",
    "amount": 500,
    "toAddress": "0x1234...",
    "type": "disbursement",
    "status": "submitted"
  }
}
```

> The `transaction.type` field is now present. For auto-disburse it will always be `"disbursement"`.

### 6.7 Reject Deposit

Unchanged from v1.

---

## 7. Transaction Monitoring Flow

### Changes from v1

- Transactions now have a `type` field: `"disbursement"` (auto-send from deposit approval) or `"manual-send"` (direct send via `POST /wallets/:id/send`).
- `depositRequestId` is `null` for manual sends.
- `token` can now be `"native"` for native token transfers.
- `chain` supports `"solana"`.

### List Transactions

```http
GET /api/transactions?status=submitted&chain=arbitrum&page=1&limit=20
GET /api/transactions?type=manual-send
Authorization: Bearer <token>
```

**Additional query params in v2:**

| Param | Values | Default |
|---|---|---|
| `chain` | `ethereum`, `arbitrum`, **`solana`** | all |
| `status` | `submitted`, `confirmed`, `failed` | all |
| `token` | `USDC`, `USDT`, **`native`** | all |
| `type` | **`disbursement`**, **`manual-send`** | all |
| `page` | number | `1` |
| `limit` | 1–100 | `20` |

**Response:**
```json
{
  "transactions": [
    {
      "_id": "665b...",
      "depositRequestId": {
        "userId": "user_abc123",
        "requestedAmount": 500,
        "requestedToken": "USDC",
        "status": "completed"
      },
      "walletId": { "address": "0xDEF...", "chain": "arbitrum", "label": "Main ARB Disburse" },
      "chain": "arbitrum",
      "token": "USDC",
      "amount": 500,
      "toAddress": "0x1234...",
      "txHash": "0x9876...",
      "type": "disbursement",
      "status": "submitted",
      "createdAt": "2026-03-14T..."
    },
    {
      "_id": "669a...",
      "depositRequestId": null,
      "walletId": { "address": "0xDEF...", "chain": "arbitrum", "label": "Main ARB Disburse" },
      "chain": "arbitrum",
      "token": "native",
      "amount": 0.05,
      "toAddress": "0x9abc...",
      "txHash": "0xabcd...",
      "type": "manual-send",
      "status": "submitted",
      "createdAt": "2026-03-14T..."
    }
  ],
  "total": 343,
  "page": 1,
  "pages": 18
}
```

### Get Single Transaction

```http
GET /api/transactions/:id
Authorization: Bearer <token>
```

### Block Explorer Links (Updated)

| Chain | Explorer URL |
|---|---|
| Ethereum | `https://etherscan.io/tx/{txHash}` |
| Arbitrum | `https://arbiscan.io/tx/{txHash}` |
| Solana | `https://solscan.io/tx/{txHash}` |

---

## 8. API Reference — Full Table (v2)

| # | Method | Endpoint | Auth | Status | Description |
|---|---|---|---|---|---|
| 1 | `POST` | `/api/admin/login` | Public | — | Login, returns JWT |
| 2 | `GET` | `/api/admin/dashboard` | JWT | — | Welcome check |
| 3 | `GET` | `/api/dashboard/overview` | JWT | — | Full dashboard summary |
| 4 | `POST` | `/api/wallets` | JWT | — | Create treasury wallet (supports `solana` + `fees`) |
| 5 | `GET` | `/api/wallets` | JWT | — | List wallets (`chain`, `purpose`, `isActive` filters) |
| 6 | `GET` | `/api/wallets/:id` | JWT | — | Get wallet details |
| 7 | `GET` | `/api/wallets/:id/balance` | JWT | — | Live on-chain balances (SOL + SPL on Solana) |
| 8 | `PATCH` | `/api/wallets/:id` | JWT | — | Update label / active status |
| **9** | **`POST`** | **`/api/wallets/:id/send`** | **JWT** | **🆕 NEW** | **Send any token from treasury wallet to any address** |
| 10 | `POST` | `/api/deposits` | API Key | — | Create deposit request (now supports `solana` chain) |
| 11 | `GET` | `/api/deposits` | JWT | — | List deposits (paginated) |
| 12 | `GET` | `/api/deposits/stats` | JWT | — | Deposit aggregate stats |
| 13 | `GET` | `/api/deposits/:id` | JWT | — | Get single deposit |
| 14 | `PATCH` | `/api/deposits/:id/verify` | JWT | — | Verify (EVM tx hash or Solana signature) |
| 15 | `PATCH` | `/api/deposits/:id/approve` | JWT | — | Approve → auto-disburse (EVM + Solana SPL) |
| 16 | `PATCH` | `/api/deposits/:id/reject` | JWT | — | Reject with notes |
| 17 | `GET` | `/api/transactions` | JWT | Updated | List tx (new `type` filter, `solana` chain filter) |
| 18 | `GET` | `/api/transactions/:id` | JWT | — | Get single transaction |

---

## 9. Error Handling

Unchanged from v1.

```json
{ "message": "Error description here" }
```

| HTTP Code | Meaning | Action |
|---|---|---|
| `400` | Validation error, invalid state, or inactive wallet | Show error message |
| `401` | Missing or expired token / API key | Redirect to login |
| `403` | Invalid token or forbidden | Redirect to login |
| `404` | Resource not found | Show "not found" state |
| `409` | Duplicate tx hash | Show conflict warning |
| `500` | Server error (e.g. Privy tx failed, insufficient funds) | Show generic error, retry |

---

## 10. Constants & Enums

### Chains (Updated)

| Name | Chain Type | Chain ID | Native Token | Explorer |
|---|---|---|---|---|
| `ethereum` | EVM | 1 | ETH | `https://etherscan.io` |
| `arbitrum` | EVM | 42161 | ETH | `https://arbiscan.io` |
| `solana` | **Solana** | — | **SOL** | `https://solscan.io` |

### Wallet Purposes (Updated)

| Purpose | Description |
|---|---|
| `receive` | Accepts deposits from users |
| `disburse` | Sends tokens to user spot wallets |
| `fees` | **NEW** — Holds native tokens (ETH/SOL) for gas fees |

### Transaction Types (NEW)

| Type | Description | `depositRequestId` |
|---|---|---|
| `disbursement` | Auto-send triggered by deposit approval | Present |
| `manual-send` | Direct send via `POST /wallets/:id/send` | `null` |

### Transaction Statuses

| Status | Description |
|---|---|
| `submitted` | Tx sent to chain, awaiting confirmation |
| `confirmed` | Tx confirmed on-chain |
| `failed` | Tx failed on-chain |

### Deposit Statuses (Unchanged)

| Status | Color | Description |
|---|---|---|
| `pending` | Yellow | Awaiting user's on-chain deposit |
| `verified` | Blue | Admin confirmed the deposit tx |
| `processing` | Orange | Auto-disbursement in progress |
| `completed` | Green | Tokens sent to user's wallet |
| `failed` | Red | Disbursement failed |
| `expired` | Gray | User didn't deposit within 24h |
| `rejected` | Red | Admin rejected the request |

### Tokens (Updated)

| Token | Decimals | Ethereum Contract | Arbitrum Contract | Solana Mint |
|---|---|---|---|---|
| `USDC` | 6 | `0xA0b8...eB48` | `0xaf88...5831` | `EPjFWdd5...Dt1v` |
| `USDT` | 6 | `0xdAC1...ec7` | `0xFd08...bb9` | `Es9vMFrz...NYB` |

### Address Formats

| Chain | Format | Example |
|---|---|---|
| Ethereum / Arbitrum | `0x` + 40 hex chars | `0xA0b86991c6218b36c1d19D4...` |
| Solana | Base58, 32–44 chars | `7xKXtg2CW87d97TXJSDpbD5jBkhe...` |

### Send Token Values

| `token` value | What is sent | Chain |
|---|---|---|
| `"USDC"` | USDC (ERC-20 or SPL) | Any |
| `"USDT"` | USDT (ERC-20 or SPL) | Any |
| `"native"` | ETH | Ethereum or Arbitrum wallet |
| `"native"` | SOL | Solana wallet |

---

## Suggested Dashboard Pages (Updated)

| Page | Primary API Calls | Notes |
|---|---|---|
| **Login** | `POST /api/admin/login` | — |
| **Overview** | `GET /api/dashboard/overview` | Now shows Solana wallet balances |
| **Wallets** | `GET /api/wallets`, `GET /api/wallets/:id/balance` | Filter by chain (incl. `solana`), show purpose badge for `fees` wallets |
| **Wallet Detail** | `GET /api/wallets/:id/balance`, `POST /api/wallets/:id/send` | **NEW: Send panel on wallet detail page** |
| **Deposits** | `GET /api/deposits`, `GET /api/deposits/stats` | Filter by chain `solana` |
| **Deposit Detail** | `GET /api/deposits/:id`, `PATCH verify/approve/reject` | Solana tx signatures look different — link to Solscan |
| **Transactions** | `GET /api/transactions` | **NEW: Filter by `type` (disbursement vs manual-send)** |
| **Tx Detail** | `GET /api/transactions/:id` | Explorer link now depends on chain |
