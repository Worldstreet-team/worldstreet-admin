import GasSponsorshipLog from '../models/GasSponsorshipLog.js';
import config from '../config/index.js';

// Track whether alert has fired for today (resets on new day)
let lastAlertDate = '';

async function checkDailyThreshold() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastAlertDate === today) return; // already fired today

  const startOfDay = new Date(today + 'T00:00:00.000Z');
  const [result] = await GasSponsorshipLog.aggregate([
    { $match: { createdAt: { $gte: startOfDay } } },
    { $group: { _id: null, total: { $sum: '$estimatedCostUSD' } } },
  ]);

  const dailySpend = result?.total ?? 0;
  if (dailySpend < config.gasDailyThresholdUSD) return;

  lastAlertDate = today;
  console.warn(`[GAS ALERT] Daily gas spend $${dailySpend.toFixed(2)} exceeded threshold $${config.gasDailyThresholdUSD}`);

  if (config.gasAlertWebhookUrl) {
    fetch(config.gasAlertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `⚠️ Gas sponsorship alert: Daily spend $${dailySpend.toFixed(2)} exceeded $${config.gasDailyThresholdUSD} threshold`,
        dailySpend,
        threshold: config.gasDailyThresholdUSD,
        date: today,
      }),
    }).catch((err) => console.error('[GAS ALERT] Webhook failed:', err.message));
  }
}

export const createGasLog = async (req, res, next) => {
  try {
    const { userId, chain, txHash, method, estimatedCostUSD } = req.body;

    if (!userId || !chain || !txHash) {
      return res.status(400).json({ message: 'userId, chain, and txHash are required' });
    }

    await GasSponsorshipLog.create({
      userId,
      chain,
      txHash,
      method: method || null,
      estimatedCostUSD: estimatedCostUSD || 0,
    });

    // Fire-and-forget threshold check
    checkDailyThreshold().catch(() => {});

    return res.status(201).json({ success: true });
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate txHash — idempotent, treat as success
      return res.status(200).json({ success: true, duplicate: true });
    }
    next(error);
  }
};

export const getGasStats = async (req, res, next) => {
  try {
    const { period = '7d', chain } = req.query;

    const days = parseInt(period) || 7;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const matchStage = { createdAt: { $gte: since } };
    if (chain) matchStage.chain = chain;

    const [byChain, byDay, topUsers, totalDocs] = await Promise.all([
      GasSponsorshipLog.aggregate([
        { $match: matchStage },
        { $group: { _id: '$chain', totalSpend: { $sum: '$estimatedCostUSD' }, count: { $sum: 1 } } },
      ]),
      GasSponsorshipLog.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            spend: { $sum: '$estimatedCostUSD' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      GasSponsorshipLog.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$userId',
            spend: { $sum: '$estimatedCostUSD' },
            txCount: { $sum: 1 },
          },
        },
        { $sort: { spend: -1 } },
        { $limit: 20 },
      ]),
      GasSponsorshipLog.countDocuments(matchStage),
    ]);

    const totalSpend = byChain.reduce((sum, c) => sum + c.totalSpend, 0);

    return res.json({
      totalSpend,
      totalTransactions: totalDocs,
      byChain: Object.fromEntries(byChain.map((c) => [c._id, { spend: c.totalSpend, count: c.count }])),
      byDay: byDay.map((d) => ({ date: d._id, spend: d.spend, count: d.count })),
      topUsers: topUsers.map((u) => ({ userId: u._id, spend: u.spend, txCount: u.txCount })),
    });
  } catch (error) {
    next(error);
  }
};
