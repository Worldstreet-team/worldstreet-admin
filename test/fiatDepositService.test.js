import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PRIVY_APP_ID = process.env.PRIVY_APP_ID || 'test-app';
process.env.PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || 'test-secret';
process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY =
  process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || 'wallet-auth:test';

const DepositRequest = (await import('../src/models/DepositRequest.js')).default;
const Wallet = (await import('../src/models/Wallet.js')).default;
const { DEPOSIT_STATUS } = await import('../src/utils/constants.js');
const { disburse } = await import('../src/services/disbursementService.js');
const {
  releaseFiatReservation,
  shouldRetryFiatDisbursementError,
} = await import('../src/services/fiatDepositService.js');

const originals = {
  depositFindById: DepositRequest.findById,
  depositFindOneAndUpdate: DepositRequest.findOneAndUpdate,
  walletUpdateOne: Wallet.updateOne,
};

test.afterEach(() => {
  DepositRequest.findById = originals.depositFindById;
  DepositRequest.findOneAndUpdate = originals.depositFindOneAndUpdate;
  Wallet.updateOne = originals.walletUpdateOne;
});

test('releaseFiatReservation decrements wallet reserved balance only after atomic reservation claim', async () => {
  assert.equal(typeof releaseFiatReservation, 'function');

  const deposit = {
    _id: 'deposit-1',
    requestedToken: 'USDT',
    requestedAmount: 25,
    treasuryWalletId: 'wallet-1',
    reservationStatus: 'reserved',
  };

  let claimCount = 0;
  let walletReleaseCount = 0;

  DepositRequest.findOneAndUpdate = async (query, update) => {
    assert.deepEqual(query, { _id: deposit._id, reservationStatus: 'reserved' });
    claimCount += 1;
    if (claimCount > 1) return null;
    return {
      ...deposit,
      status: update.$set.status,
      reservationStatus: update.$set.reservationStatus,
      reservationReleasedAt: update.$set.reservationReleasedAt,
    };
  };
  DepositRequest.findById = async () => ({ ...deposit, reservationStatus: 'released' });
  Wallet.updateOne = async (query, update) => {
    walletReleaseCount += 1;
    assert.deepEqual(query, { _id: deposit.treasuryWalletId });
    assert.deepEqual(update, { $inc: { 'reserved.USDT': -25 } });
    return { modifiedCount: 1 };
  };

  await releaseFiatReservation(deposit, 'first release', DEPOSIT_STATUS.REJECTED);
  await releaseFiatReservation(deposit, 'duplicate release', DEPOSIT_STATUS.REJECTED);

  assert.equal(claimCount, 2);
  assert.equal(walletReleaseCount, 1);
});

test('shouldRetryFiatDisbursementError does not retry ambiguous broadcast failures', () => {
  assert.equal(typeof shouldRetryFiatDisbursementError, 'function');

  const ambiguous = new Error('request timed out after broadcast');
  ambiguous.broadcastAttempted = true;

  assert.equal(shouldRetryFiatDisbursementError(ambiguous), false);
  assert.equal(shouldRetryFiatDisbursementError(new Error('temporary database error')), true);
});

test('disburse atomically claims verified deposits before sending', async () => {
  let claimCalled = false;

  DepositRequest.findOneAndUpdate = async (query, update) => {
    claimCalled = true;
    assert.equal(String(query._id), 'deposit-2');
    assert.equal(query.status, DEPOSIT_STATUS.VERIFIED);
    assert.equal(update.$set.status, DEPOSIT_STATUS.PROCESSING);
    return null;
  };
  DepositRequest.findById = async () => ({
    _id: 'deposit-2',
    status: DEPOSIT_STATUS.PROCESSING,
  });

  await assert.rejects(() => disburse('deposit-2'), /status is "processing"/);
  assert.equal(claimCalled, true);
});
