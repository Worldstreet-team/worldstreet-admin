import cron from 'node-cron';
import config from '../config/index.js';
import { pollEthereum, pollSolana, pollTron } from '../services/depositWatcherService.js';
import { expireFiatReservations } from '../services/fiatDepositService.js';

let ethPolling = false;
let solPolling = false;
let tronPolling = false;
let fiatExpiryRunning = false;

const runEthPoll = async () => {
  if (ethPolling) return;
  ethPolling = true;
  try {
    await pollEthereum();
  } catch (err) {
    console.error('[Jobs] ETH poll error:', err.message);
  } finally {
    ethPolling = false;
  }
};

const runSolPoll = async () => {
  if (solPolling) return;
  solPolling = true;
  try {
    await pollSolana();
  } catch (err) {
    console.error('[Jobs] SOL poll error:', err.message);
  } finally {
    solPolling = false;
  }
};

const runTronPoll = async () => {
  if (tronPolling) return;
  tronPolling = true;
  try {
    await pollTron();
  } catch (err) {
    console.error('[Jobs] TRON poll error:', err.message);
  } finally {
    tronPolling = false;
  }
};

const runFiatReservationExpiry = async () => {
  if (fiatExpiryRunning) return;
  fiatExpiryRunning = true;
  try {
    const count = await expireFiatReservations();
    if (count > 0) console.log(`[Jobs] Expired ${count} fiat deposit reservation(s)`);
  } catch (err) {
    console.error('[Jobs] Fiat reservation expiry error:', err.message);
  } finally {
    fiatExpiryRunning = false;
  }
};

export const startJobs = () => {
  cron.schedule('* * * * *', runFiatReservationExpiry);

  if (!config.autoDisburseEnabled) {
    console.log('[Jobs] Auto-disburse is disabled (AUTO_DISBURSE_ENABLED=false)');
    return;
  }

  const seconds = config.pollIntervalSeconds;
  const cronExpr = `*/${seconds} * * * * *`; // every N seconds

  cron.schedule(cronExpr, runEthPoll);
  cron.schedule(cronExpr, runSolPoll);
  cron.schedule(cronExpr, runTronPoll);

  console.log(`[Jobs] Deposit watcher started — polling every ${seconds}s`);
};
