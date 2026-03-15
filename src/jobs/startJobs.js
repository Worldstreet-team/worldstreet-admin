import cron from 'node-cron';
import config from '../config/index.js';
import { pollEthereum, pollSolana } from '../services/depositWatcherService.js';

let ethPolling = false;
let solPolling = false;

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

export const startJobs = () => {
  if (!config.autoDisburseEnabled) {
    console.log('[Jobs] Auto-disburse is disabled (AUTO_DISBURSE_ENABLED=false)');
    return;
  }

  const seconds = config.pollIntervalSeconds;
  const cronExpr = `*/${seconds} * * * * *`; // every N seconds

  cron.schedule(cronExpr, runEthPoll);
  cron.schedule(cronExpr, runSolPoll);

  console.log(`[Jobs] Deposit watcher started — polling every ${seconds}s`);
};
