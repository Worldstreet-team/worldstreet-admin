import { timingSafeEqual } from 'crypto';
import config from '../config/index.js';

export const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ message: 'API key required' });

  const expected = config.dashboardApiKey;
  if (!expected) return res.status(500).json({ message: 'API key not configured' });

  // Constant-time comparison to prevent timing attacks
  const keyBuffer = Buffer.from(apiKey);
  const expectedBuffer = Buffer.from(expected);
  if (keyBuffer.length !== expectedBuffer.length || !timingSafeEqual(keyBuffer, expectedBuffer)) {
    return res.status(403).json({ message: 'Invalid API key' });
  }

  next();
};
