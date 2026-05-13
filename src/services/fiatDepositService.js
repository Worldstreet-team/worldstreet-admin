import DepositRequest from '../models/DepositRequest.js';
import Wallet from '../models/Wallet.js';
import { getWalletBalances } from './balanceService.js';
import { disburse } from './disbursementService.js';
import { findDisburseWallet } from './walletService.js';
import { sendDashboardDisbursementCallback } from './dashboardCallbackService.js';
import { DEPOSIT_STATUS } from '../utils/constants.js';

const SUPPORTED_FIAT_CHAINS = ['ethereum', 'solana', 'tron'];
const RESERVATION_TTL_MS = 30 * 60 * 1000;
const DISBURSEMENT_RETRY_DELAYS_MS = [0, 60_000, 240_000];
const activeExecutions = new Set();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const roundAmount = (value) => Math.round(Number(value) * 1_000_000) / 1_000_000;
const reservationPath = (token) => `reserved.${token}`;

const serviceError = (message, statusCode = 400, code = 'FIAT_DEPOSIT_ERROR') => {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
};

const ensureDisburseWalletSupportsToken = (wallet, token) => {
  if (!wallet) throw serviceError('No active disburse wallet for this chain', 409, 'NO_DISBURSE_WALLET');
  if (Array.isArray(wallet.tokens) && wallet.tokens.length > 0 && !wallet.tokens.includes(token)) {
    throw serviceError(`Disburse wallet does not support ${token}`, 409, 'NO_DISBURSE_WALLET');
  }
};

const getWalletCapacity = async (wallet, token) => {
  const balances = await getWalletBalances(wallet.chain, wallet.address, [token]);
  const balance = Number(balances[token] || 0);
  const reserved = Number(wallet.reserved?.[token] || 0);
  return {
    balance: roundAmount(balance),
    reserved: roundAmount(reserved),
    available: roundAmount(Math.max(balance - reserved, 0)),
  };
};

const reserveOnWallet = async (wallet, token, amount, observedBalance) => {
  const balance = Number.isFinite(observedBalance) ? observedBalance : (await getWalletCapacity(wallet, token)).balance;
  const maxCurrentReserved = roundAmount(balance - amount);
  if (maxCurrentReserved < 0) {
    throw serviceError('Insufficient liquidity for this reservation', 409, 'INSUFFICIENT_LIQUIDITY');
  }

  const path = reservationPath(token);
  const updated = await Wallet.findOneAndUpdate(
    {
      _id: wallet._id,
      isActive: true,
      $or: [
        { [path]: { $lte: maxCurrentReserved } },
        { [path]: { $exists: false } },
      ],
    },
    { $inc: { [path]: amount } },
    { new: true },
  );

  if (!updated) {
    throw serviceError('Insufficient liquidity for this reservation', 409, 'INSUFFICIENT_LIQUIDITY');
  }
  return updated;
};

export const releaseFiatReservation = async (deposit, reason, nextStatus = null) => {
  if (!deposit?._id || deposit.reservationStatus !== 'reserved') return deposit;

  const nextReservationStatus = nextStatus === DEPOSIT_STATUS.COMPLETED ? 'consumed' : 'released';
  const timestampField = nextReservationStatus === 'consumed' ? 'reservationConsumedAt' : 'reservationReleasedAt';
  const update = {
    reservationStatus: nextReservationStatus,
    [timestampField]: new Date(),
  };
  if (nextStatus) update.status = nextStatus;
  if (reason) update.adminNotes = reason;

  const released = await DepositRequest.findOneAndUpdate(
    { _id: deposit._id, reservationStatus: 'reserved' },
    { $set: update },
    { new: true },
  );

  if (!released) return DepositRequest.findById(deposit._id);

  const path = reservationPath(released.requestedToken);
  await Wallet.updateOne(
    { _id: released.treasuryWalletId },
    { $inc: { [path]: -Number(released.requestedAmount) } },
  );

  return released;
};

export const shouldRetryFiatDisbursementError = (err) => !err?.broadcastAttempted && !err?.noRetry;

const serializeDeposit = (deposit) => ({
  adminDepositId: String(deposit._id),
  reservationExpiresAt: deposit.expiresAt,
  deposit,
});

export const getFiatAvailability = async (token = 'USDT') => {
  const chains = {};

  await Promise.all(SUPPORTED_FIAT_CHAINS.map(async (chain) => {
    try {
      const wallet = await findDisburseWallet(chain);
      ensureDisburseWalletSupportsToken(wallet, token);
      const capacity = await getWalletCapacity(wallet, token);
      chains[chain] = {
        enabled: capacity.available > 0,
        ...capacity,
        reason: capacity.available > 0 ? undefined : 'Insufficient liquidity',
      };
    } catch (err) {
      chains[chain] = {
        enabled: false,
        available: 0,
        balance: 0,
        reserved: 0,
        reason: err.message,
      };
    }
  }));

  return { success: true, token, chains };
};

export const reserveFiatDeposit = async (payload) => {
  const token = payload.requestedToken || 'USDT';
  const amount = roundAmount(payload.requestedAmount);
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

  let existing = await DepositRequest.findOne({ source: 'fiat', externalReference: payload.externalReference });
  if (existing) {
    if (existing.status === DEPOSIT_STATUS.COMPLETED || existing.disburseTxHash) {
      return serializeDeposit(existing);
    }

    if (
      existing.status === DEPOSIT_STATUS.PENDING &&
      existing.reservationStatus === 'reserved' &&
      existing.expiresAt > new Date()
    ) {
      return serializeDeposit(existing);
    }

    if (existing.reservationStatus === 'reserved') {
      await releaseFiatReservation(existing, 'Expired reservation released before refresh', DEPOSIT_STATUS.EXPIRED);
      existing = await DepositRequest.findById(existing._id);
    }
  }

  const wallet = await findDisburseWallet(payload.chain);
  ensureDisburseWalletSupportsToken(wallet, token);
  const capacity = await getWalletCapacity(wallet, token);
  await reserveOnWallet(wallet, token, amount, capacity.balance);

  try {
    if (existing) {
      existing.set({
        source: 'fiat',
        userId: payload.userId,
        userWalletAddress: payload.userWalletAddress,
        chain: payload.chain,
        walletType: 'asset',
        requestedToken: token,
        requestedAmount: amount,
        depositChain: payload.chain,
        depositToken: token,
        depositAmount: amount,
        treasuryWalletId: wallet._id,
        disburseWalletId: null,
        fiatProvider: payload.fiatProvider,
        fiatCurrency: payload.fiatCurrency,
        fiatAmount: payload.fiatAmount,
        status: DEPOSIT_STATUS.PENDING,
        adminNotes: '',
        expiresAt,
        reservationStatus: 'reserved',
        reservationReleasedAt: null,
        reservationConsumedAt: null,
        fiatFinalizedAt: null,
      });
      await existing.save();
      return serializeDeposit(existing);
    }

    const deposit = await DepositRequest.create({
      source: 'fiat',
      externalReference: payload.externalReference,
      fiatProvider: payload.fiatProvider,
      fiatCurrency: payload.fiatCurrency,
      fiatAmount: payload.fiatAmount,
      userId: payload.userId,
      userWalletAddress: payload.userWalletAddress,
      chain: payload.chain,
      walletType: 'asset',
      requestedToken: token,
      requestedAmount: amount,
      depositChain: payload.chain,
      depositToken: token,
      depositAmount: amount,
      treasuryWalletId: wallet._id,
      skipDisbursement: false,
      reservationStatus: 'reserved',
      expiresAt,
      description: `Fiat ${payload.fiatProvider} deposit ${payload.externalReference}`,
    });

    return serializeDeposit(deposit);
  } catch (err) {
    await Wallet.updateOne({ _id: wallet._id }, { $inc: { [reservationPath(token)]: -amount } });
    throw err;
  }
};

export const cancelFiatDeposit = async ({ externalReference, reason = 'Cancelled by dashboard' }) => {
  const deposit = await DepositRequest.findOne({ source: 'fiat', externalReference });
  if (!deposit) return { success: true, cancelled: false };

  if ([DEPOSIT_STATUS.PROCESSING, DEPOSIT_STATUS.COMPLETED, DEPOSIT_STATUS.VERIFIED].includes(deposit.status)) {
    return { success: true, cancelled: false, deposit };
  }

  await releaseFiatReservation(deposit, reason, DEPOSIT_STATUS.REJECTED);
  return { success: true, cancelled: true, deposit };
};

export const executeFiatDeposit = async (payload) => {
  let deposit = await DepositRequest.findOne({ source: 'fiat', externalReference: payload.externalReference });

  if (deposit?.fiatFinalizedAt && deposit.status === DEPOSIT_STATUS.FAILED) {
    throw serviceError(deposit.adminNotes || 'Fiat disbursement already failed', 409, 'DISBURSEMENT_FAILED');
  }

  if (!deposit || [DEPOSIT_STATUS.EXPIRED, DEPOSIT_STATUS.REJECTED].includes(deposit.status)) {
    const reserved = await reserveFiatDeposit(payload);
    deposit = reserved.deposit;
  }

  if (deposit.status === DEPOSIT_STATUS.COMPLETED) {
    return { accepted: true, status: 'completed', txHash: deposit.disburseTxHash, deposit };
  }

  if (deposit.status === DEPOSIT_STATUS.PENDING) {
    if (deposit.expiresAt <= new Date() || deposit.reservationStatus !== 'reserved') {
      await releaseFiatReservation(deposit, 'Reservation expired before paid execute', DEPOSIT_STATUS.EXPIRED);
      const reserved = await reserveFiatDeposit(payload);
      deposit = reserved.deposit;
    }

    deposit = await DepositRequest.findOneAndUpdate(
      { _id: deposit._id, status: DEPOSIT_STATUS.PENDING },
      {
        $set: {
          status: DEPOSIT_STATUS.VERIFIED,
          verifiedAt: new Date(),
          fiatLastExecuteAt: new Date(),
        },
      },
      { new: true },
    ) || await DepositRequest.findById(deposit._id);
  }

  startFiatDisbursementWorker(deposit.externalReference);
  return { accepted: true, status: deposit.status, deposit };
};

export const startFiatDisbursementWorker = (externalReference) => {
  if (activeExecutions.has(externalReference)) return;
  activeExecutions.add(externalReference);
  setImmediate(async () => {
    try {
      await processFiatDisbursement(externalReference);
    } catch (err) {
      console.error(`[FiatDeposit] Worker failed for ${externalReference}:`, err.message);
    } finally {
      activeExecutions.delete(externalReference);
    }
  });
};

export const processFiatDisbursement = async (externalReference) => {
  let lastError = null;

  for (let attempt = 0; attempt < DISBURSEMENT_RETRY_DELAYS_MS.length; attempt += 1) {
    const delay = DISBURSEMENT_RETRY_DELAYS_MS[attempt];
    if (delay) await wait(delay);

    let deposit = await DepositRequest.findOne({ source: 'fiat', externalReference });
    if (!deposit) throw new Error(`Fiat deposit ${externalReference} not found`);
    if (deposit.status === DEPOSIT_STATUS.COMPLETED && deposit.disburseTxHash) return deposit;
    if (deposit.fiatFinalizedAt && deposit.status === DEPOSIT_STATUS.FAILED) return deposit;

    if (deposit.status === DEPOSIT_STATUS.FAILED) {
      deposit.status = DEPOSIT_STATUS.VERIFIED;
      await deposit.save();
    }

    if (deposit.status !== DEPOSIT_STATUS.VERIFIED) {
      return deposit;
    }

    await DepositRequest.updateOne({ _id: deposit._id }, { $inc: { fiatDisbursementAttempts: 1 } });

    try {
      const result = await disburse(deposit._id);
      deposit = result.deposit;
      await releaseFiatReservation(deposit, 'Reservation consumed by fiat disbursement', DEPOSIT_STATUS.COMPLETED);

      const eventId = `fiat_${externalReference}_submitted`;
      await sendDashboardDisbursementCallback({
        event: 'fiat_disbursement.submitted',
        eventId,
        externalReference,
        adminDepositId: String(deposit._id),
        chain: deposit.chain,
        token: deposit.requestedToken,
        amount: deposit.requestedAmount,
        txHash: deposit.disburseTxHash,
      });

      deposit.fiatLastCallbackEventId = eventId;
      await deposit.save();
      return deposit;
    } catch (err) {
      lastError = err;
      console.error(`[FiatDeposit] Attempt ${attempt + 1} failed for ${externalReference}:`, err.message);
      if (!shouldRetryFiatDisbursementError(err)) break;
    }
  }

  const failed = await DepositRequest.findOne({ source: 'fiat', externalReference });
  if (!failed) throw lastError || new Error(`Fiat deposit ${externalReference} not found`);

  failed.status = DEPOSIT_STATUS.FAILED;
  failed.fiatFinalizedAt = new Date();
  failed.adminNotes = `Fiat disbursement failed after retries: ${lastError?.message || 'Unknown error'}`;
  await failed.save();
  await releaseFiatReservation(failed, failed.adminNotes, DEPOSIT_STATUS.FAILED);

  const eventId = `fiat_${externalReference}_failed`;
  await sendDashboardDisbursementCallback({
    event: 'fiat_disbursement.failed',
    eventId,
    externalReference,
    adminDepositId: String(failed._id),
    chain: failed.chain,
    token: failed.requestedToken,
    amount: failed.requestedAmount,
    reason: failed.adminNotes,
  });

  failed.fiatLastCallbackEventId = eventId;
  await failed.save();
  return failed;
};

export const expireFiatReservations = async () => {
  const expired = await DepositRequest.find({
    source: 'fiat',
    status: DEPOSIT_STATUS.PENDING,
    reservationStatus: 'reserved',
    expiresAt: { $lte: new Date() },
  }).limit(100);

  for (const deposit of expired) {
    await releaseFiatReservation(deposit, 'Fiat reservation expired', DEPOSIT_STATUS.EXPIRED);
  }

  return expired.length;
};
