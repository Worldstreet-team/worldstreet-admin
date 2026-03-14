# WorldStreet Admin — Dashboard API Integration Guide

**Base URL:** `http://localhost:3000` (dev) · `https://your-render-url.com` (prod)

---

## Table of Contents

1. [Authentication Flow](#1-authentication-flow)
2. [Dashboard Overview Flow](#2-dashboard-overview-flow)
3. [Treasury Wallet Management Flow](#3-treasury-wallet-management-flow)
4. [Deposit Request Lifecycle Flow](#4-deposit-request-lifecycle-flow)
5. [Transaction Monitoring Flow](#5-transaction-monitoring-flow)
6. [API Reference](#6-api-reference)
7. [Error Handling](#7-error-handling)
8. [Constants & Enums](#8-constants--enums)

---

## 1. Authentication Flow

The admin dashboard authenticates via JWT. All protected endpoints require the token in the `Authorization` header.

```
┌──────────────┐         POST /api/admin/login         ┌──────────────┐
│   Login Page │ ─────────────────────────────────────▶ │    Server    │
│              │ ◀───────────────────────────────────── │              │
│              │         { token: "eyJhb..." }          │              │
└──────────────┘                                        └──────────────┘
        │
        │  Store token (localStorage / cookie)
        │
        ▼
   All subsequent requests include:
   Authorization: Bearer <token>
```

**Login:**

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

**Token Usage — add to every protected request:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

> Token expires in **1 hour**. On `401` or `403`, redirect to login.

---

## 2. Dashboard Overview Flow

The main dashboard page shows a real-time summary of the system. Call this on page load and optionally poll every 30–60s.

```
┌─────────────────────────────────────────────────────────┐
│                 DASHBOARD OVERVIEW                       │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │  Treasury    │  │   Pending   │  │  Today's       │  │
│  │  Balances    │  │   Deposits  │  │  Volume        │  │
│  │  (per wallet)│  │   Count     │  │  (by token)    │  │
│  └─────────────┘  └─────────────┘  └────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Recent Activity (last 10 completed/failed)       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

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
    }
  ],
  "statusCounts": [
    { "_id": "pending", "count": 12 },
    { "_id": "completed", "count": 340 }
  ],
  "pendingCount": 12,
  "todayVolume": [
    { "_id": "USDC", "totalAmount": 15400, "count": 8 }
  ],
  "recentActivity": [
    {
      "userId": "user_abc123",
      "requestedToken": "USDC",
      "requestedAmount": 500,
      "status": "completed",
      "updatedAt": "2026-03-14T10:30:00.000Z",
      "chain": "arbitrum"
    }
  ]
}
```

**Frontend mapping:**
| Response Field | Dashboard Widget |
|---|---|
| `walletBalances` | Treasury wallet cards (address, chain, balances per token) |
| `pendingCount` | Pending requests badge / alert |
| `statusCounts` | Donut chart or status breakdown |
| `todayVolume` | Volume card (total amount disbursed today) |
| `recentActivity` | Activity feed / table |

---

## 3. Treasury Wallet Management Flow

Treasury wallets are created once during setup and monitored ongoing. The admin creates **receive** wallets (to collect user deposits) and **disburse** wallets (to send tokens to users).

### Recommended Initial Setup

Create these 3 wallets after first login:

| # | Chain | Purpose | Tokens | Label |
|---|---|---|---|---|
| 1 | `ethereum` | `receive` | `["USDC", "USDT"]` | Main ETH Receive |
| 2 | `arbitrum` | `disburse` | `["USDC", "USDT"]` | Main ARB Disburse |
| 3 | `arbitrum` | `receive` | `["USDC", "USDT"]` | ARB Receive (optional) |

### Create Wallet

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

**Response (201):**
```json
{
  "_id": "665a...",
  "privyWalletId": "wallet_abc123",
  "address": "0xDEF...",
  "chain": "arbitrum",
  "chainId": "eip155:42161",
  "purpose": "disburse",
  "tokens": ["USDC", "USDT"],
  "label": "Main ARB Disburse",
  "isActive": true,
  "createdAt": "2026-03-14T...",
  "updatedAt": "2026-03-14T..."
}
```

### List All Wallets

```http
GET /api/wallets
GET /api/wallets?chain=arbitrum
GET /api/wallets?purpose=receive
GET /api/wallets?isActive=true
Authorization: Bearer <token>
```

### Get Live On-Chain Balance

```http
GET /api/wallets/:id/balance
Authorization: Bearer <token>
```

**Response:**
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

### Update Wallet (label or deactivate)

```http
PATCH /api/wallets/:id
Authorization: Bearer <token>
Content-Type: application/json

{ "label": "Renamed Wallet", "isActive": false }
```

---

## 4. Deposit Request Lifecycle Flow

This is the core business flow. Deposits move through a strict state machine.

### State Machine

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

### 4.1 Create Deposit (called by user-facing dashboard, NOT admin UI)

> This endpoint uses **API Key** auth, not JWT. It's called by the external crypto dashboard when a user initiates a deposit.

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

**Response (201):**
```json
{
  "deposit": { "...full deposit object..." },
  "treasuryAddress": "0xABC...",
  "treasuryChain": "ethereum"
}
```

The `treasuryAddress` is shown to the user so they know where to send their stablecoin.

### 4.2 List Deposits (Admin Dashboard — Deposits Page)

```http
GET /api/deposits?status=pending&page=1&limit=20
Authorization: Bearer <token>
```

**Query Params:**

| Param | Values | Default |
|---|---|---|
| `status` | `pending`, `verified`, `processing`, `completed`, `failed`, `expired`, `rejected` | all |
| `userId` | any string | all |
| `chain` | `ethereum`, `arbitrum` | all |
| `page` | number | `1` |
| `limit` | 1–100 | `20` |

**Response:**
```json
{
  "deposits": [
    {
      "_id": "665a...",
      "userId": "user_abc123",
      "userWalletAddress": "0x1234...",
      "chain": "arbitrum",
      "requestedToken": "USDC",
      "requestedAmount": 500,
      "depositChain": "ethereum",
      "depositToken": "USDT",
      "depositAmount": 500,
      "depositTxHash": null,
      "status": "pending",
      "description": "Fund spot wallet",
      "treasuryWalletId": { "address": "0xABC...", "chain": "ethereum", "label": "Main ETH Receive" },
      "expiresAt": "2026-03-15T...",
      "createdAt": "2026-03-14T..."
    }
  ],
  "total": 45,
  "page": 1,
  "pages": 3
}
```

### 4.3 Get Deposit Stats

```http
GET /api/deposits/stats
Authorization: Bearer <token>
```

**Response:**
```json
{
  "statusCounts": [
    { "_id": "pending", "count": 12 },
    { "_id": "completed", "count": 340 },
    { "_id": "failed", "count": 3 }
  ],
  "volumeByToken": [
    { "_id": "USDC", "totalAmount": 125000, "count": 320 },
    { "_id": "USDT", "totalAmount": 18000, "count": 23 }
  ]
}
```

### 4.4 Verify Deposit (Admin Action)

When the admin confirms the user's on-chain deposit to the treasury wallet, they submit the transaction hash.

```http
PATCH /api/deposits/:id/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "depositTxHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
}
```

**Response (200):** Updated deposit with `status: "verified"` and `verifiedAt` timestamp.

**Errors:**
- `400` — Deposit is not in `pending` status
- `409` — Transaction hash already used (prevents double-spend)

### 4.5 Approve & Auto-Disburse (Admin Action)

After verification, the admin approves the deposit. This **automatically sends** the requested token (e.g., USDC on Arbitrum) to the user's spot wallet via Privy.

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
    "status": "submitted"
  }
}
```

> **This is the key action.** Behind the scenes: the server builds an ERC-20 `transfer()` call, sends it through Privy's wallet API using the authorization key, and records the transaction.

### 4.6 Reject Deposit (Admin Action)

```http
PATCH /api/deposits/:id/reject
Authorization: Bearer <token>
Content-Type: application/json

{
  "adminNotes": "Suspicious deposit, amount mismatch"
}
```

**Response (200):** Updated deposit with `status: "rejected"`.

**Errors:** `400` — Cannot reject deposits in `completed` or `processing` status.

---

## 5. Transaction Monitoring Flow

Transactions represent outgoing disbursements from treasury wallets to user spot wallets.

### List Transactions

```http
GET /api/transactions?status=submitted&chain=arbitrum&page=1&limit=20
Authorization: Bearer <token>
```

**Query Params:**

| Param | Values | Default |
|---|---|---|
| `chain` | `ethereum`, `arbitrum` | all |
| `status` | `submitted`, `confirmed`, `failed` | all |
| `token` | `USDC`, `USDT` | all |
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
        "userWalletAddress": "0x1234...",
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
      "status": "submitted",
      "createdAt": "2026-03-14T..."
    }
  ],
  "total": 342,
  "page": 1,
  "pages": 18
}
```

### Get Single Transaction

```http
GET /api/transactions/:id
Authorization: Bearer <token>
```

> **Tip:** Link `txHash` to a block explorer: `https://arbiscan.io/tx/{txHash}` for Arbitrum, `https://etherscan.io/tx/{txHash}` for Ethereum.

---

## 6. API Reference — Quick Table

| # | Method | Endpoint | Auth | Description |
|---|---|---|---|---|
| 1 | `POST` | `/api/admin/login` | Public | Login, returns JWT |
| 2 | `GET` | `/api/admin/dashboard` | JWT | Welcome check |
| 3 | `GET` | `/api/dashboard/overview` | JWT | Full dashboard summary |
| 4 | `POST` | `/api/wallets` | JWT | Create treasury wallet (Privy) |
| 5 | `GET` | `/api/wallets` | JWT | List wallets (filterable) |
| 6 | `GET` | `/api/wallets/:id` | JWT | Get wallet details |
| 7 | `GET` | `/api/wallets/:id/balance` | JWT | Live on-chain balances |
| 8 | `PATCH` | `/api/wallets/:id` | JWT | Update label / active status |
| 9 | `POST` | `/api/deposits` | API Key | Create deposit request |
| 10 | `GET` | `/api/deposits` | JWT | List deposits (paginated) |
| 11 | `GET` | `/api/deposits/stats` | JWT | Deposit aggregate stats |
| 12 | `GET` | `/api/deposits/:id` | JWT | Get single deposit |
| 13 | `PATCH` | `/api/deposits/:id/verify` | JWT | Verify with tx hash |
| 14 | `PATCH` | `/api/deposits/:id/approve` | JWT | Approve → auto-disburse |
| 15 | `PATCH` | `/api/deposits/:id/reject` | JWT | Reject with notes |
| 16 | `GET` | `/api/transactions` | JWT | List transactions |
| 17 | `GET` | `/api/transactions/:id` | JWT | Get single transaction |

---

## 7. Error Handling

All errors follow a consistent format:

```json
{ "message": "Error description here" }
```

| HTTP Code | Meaning | Action |
|---|---|---|
| `400` | Validation error or invalid state transition | Show error message to admin |
| `401` | Missing or expired token / API key | Redirect to login |
| `403` | Invalid token or forbidden | Redirect to login |
| `404` | Resource not found | Show "not found" state |
| `409` | Duplicate (e.g., tx hash reuse) | Show conflict warning |
| `500` | Server error | Show generic error, retry |

---

## 8. Constants & Enums

### Deposit Statuses

| Status | Color Suggestion | Description |
|---|---|---|
| `pending` | Yellow | Awaiting user's on-chain deposit |
| `verified` | Blue | Admin confirmed the deposit tx |
| `processing` | Orange | Auto-disbursement in progress |
| `completed` | Green | Tokens sent to user's wallet |
| `failed` | Red | Disbursement failed |
| `expired` | Gray | User didn't deposit within 24h |
| `rejected` | Red | Admin rejected the request |

### Transaction Statuses

| Status | Description |
|---|---|
| `submitted` | Tx sent to chain, awaiting confirmation |
| `confirmed` | Tx confirmed on-chain |
| `failed` | Tx failed on-chain |

### Chains

| Name | Chain ID | Explorer |
|---|---|---|
| `ethereum` | 1 | `https://etherscan.io` |
| `arbitrum` | 42161 | `https://arbiscan.io` |

### Tokens

| Token | Decimals | Display |
|---|---|---|
| `USDC` | 6 | USDC |
| `USDT` | 6 | USDT |

### Wallet Purposes

| Purpose | Description |
|---|---|
| `receive` | Accepts deposits from users |
| `disburse` | Sends tokens to user spot wallets |

---

## Suggested Dashboard Pages

| Page | Primary API Calls | Refresh |
|---|---|---|
| **Login** | `POST /api/admin/login` | — |
| **Overview** | `GET /api/dashboard/overview` | Poll every 30–60s |
| **Wallets** | `GET /api/wallets`, `GET /api/wallets/:id/balance` | On load + manual refresh |
| **Deposits** | `GET /api/deposits`, `GET /api/deposits/stats` | Poll every 15–30s |
| **Deposit Detail** | `GET /api/deposits/:id`, `PATCH verify/approve/reject` | On load |
| **Transactions** | `GET /api/transactions` | Poll every 30s |
| **Tx Detail** | `GET /api/transactions/:id` | On load |
