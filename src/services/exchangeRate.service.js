/**
 * Service de récupération du taux USD/XOF via MoneyConvert API.
 * - API : https://cdn.moneyconvert.net/api/latest.json (mise à jour toutes les 5 min)
 * - Cache : 15 min pour un taux frais
 * - Fallback : 557 XOF si l'API échoue
 * - Option : EXCHANGE_RATE_USD_XOF dans .env pour forcer un taux (maintenance)
 */

const https = require('https');
const logger = require('../utils/logger');

const FALLBACK_RATE = 557;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 8000;

let cachedRate = null;
let cacheExpiry = 0;

const RATE_OVERRIDE = process.env.EXCHANGE_RATE_USD_XOF
  ? parseFloat(process.env.EXCHANGE_RATE_USD_XOF)
  : null;

const EXCHANGE_API_URL = 'https://cdn.moneyconvert.net/api/latest.json';

function fetchFromApi() {
  return new Promise((resolve, reject) => {
    const req = https.get(EXCHANGE_API_URL, {
      headers: {
        'User-Agent': 'GlobalExchange/1.0 (https://global-ex-woad.vercel.app)',
        'Accept': 'application/json',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`API returned ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const rate = json.rates?.XOF;
          if (rate && typeof rate === 'number' && rate > 0) {
            resolve(Math.round(rate * 100) / 100);
          } else {
            reject(new Error('Invalid XOF rate in response'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function fetchUsdToXofRate() {
  if (RATE_OVERRIDE && RATE_OVERRIDE > 0) {
    logger.debug('Exchange rate: using override from env', { rate: RATE_OVERRIDE });
    return Math.round(RATE_OVERRIDE * 100) / 100;
  }

  if (cachedRate !== null && Date.now() < cacheExpiry) {
    return cachedRate;
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const rate = await fetchFromApi();
      cachedRate = rate;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      logger.debug('Exchange rate fetched from API', { rate, attempt: attempt + 1 });
      return rate;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  logger.warn('Exchange rate API failed, using fallback', {
    error: lastError?.message,
    fallback: FALLBACK_RATE,
  });
  return FALLBACK_RATE;
}

module.exports = {
  fetchUsdToXofRate,
  FALLBACK_RATE,
};
