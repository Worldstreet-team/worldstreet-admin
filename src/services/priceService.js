const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

const NATIVE_COIN_IDS = {
  ethereum: 'ethereum',
  arbitrum: 'ethereum', // Arbitrum uses ETH as native
  solana: 'solana',
  tron: 'tronix',
};

const CACHE_TTL_MS = 60_000; // 1 minute
let priceCache = { prices: {}, fetchedAt: 0 };

const fetchPrices = async () => {
  const now = Date.now();
  if (now - priceCache.fetchedAt < CACHE_TTL_MS && Object.keys(priceCache.prices).length) {
    return priceCache.prices;
  }

  const ids = [...new Set(Object.values(NATIVE_COIN_IDS))].join(',');
  const url = `${COINGECKO_API}?ids=${ids}&vs_currencies=usd`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);

  const data = await res.json();
  // data shape: { ethereum: { usd: 3000 }, solana: { usd: 150 } }
  const prices = {};
  for (const [id, values] of Object.entries(data)) {
    prices[id] = values.usd;
  }

  priceCache = { prices, fetchedAt: now };
  return prices;
};

/**
 * Get the USD price of the native coin for a given chain.
 * Returns null if the price cannot be fetched.
 */
export const getNativeCoinPrice = async (chain) => {
  const coinId = NATIVE_COIN_IDS[chain];
  if (!coinId) return null;

  try {
    const prices = await fetchPrices();
    return prices[coinId] ?? null;
  } catch {
    return null;
  }
};

/**
 * Convert a native balance string to its USD value.
 * Returns null if price is unavailable.
 */
export const toUsdValue = (balanceStr, priceUsd) => {
  if (priceUsd == null) return null;
  const val = parseFloat(balanceStr);
  if (Number.isNaN(val)) return null;
  return parseFloat((val * priceUsd).toFixed(2));
};
