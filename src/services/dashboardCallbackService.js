import { createHmac, randomUUID } from 'crypto';
import config from '../config/index.js';

const CALLBACK_RETRY_DELAYS_MS = [0, 2_000, 8_000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callbackUrl = () => {
  if (!config.dashboardCallbackUrl) throw new Error('DASHBOARD_CALLBACK_URL is not configured');
  return new URL('/api/deposit/disbursement-webhook', config.dashboardCallbackUrl).toString();
};

const signatureFor = (timestamp, body) => {
  if (!config.dashboardWebhookSecret) throw new Error('DASHBOARD_WEBHOOK_SECRET is not configured');
  return createHmac('sha256', config.dashboardWebhookSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
};

export const sendDashboardDisbursementCallback = async (payload) => {
  const eventId = payload.eventId || `evt_${randomUUID()}`;
  const body = JSON.stringify({ ...payload, eventId });
  const url = callbackUrl();
  let lastError;

  for (const delay of CALLBACK_RETRY_DELAYS_MS) {
    if (delay) await wait(delay);

    const timestamp = String(Date.now());
    const signature = signatureFor(timestamp, body);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worldstreet-signature': signature,
          'x-worldstreet-timestamp': timestamp,
          'x-worldstreet-event-id': eventId,
        },
        body,
      });

      if (response.ok) return { eventId };
      const responseBody = await response.text().catch(() => '');
      throw new Error(`Dashboard callback failed ${response.status}: ${responseBody}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Dashboard callback failed');
};
