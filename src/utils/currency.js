const USD = "USD";
const DEFAULT_TIMEOUT_MS = 5000;
const LATEST_CACHE_TTL_MS = 60 * 60 * 1000;

const rateCache = new Map();

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const roundCurrency = (value) => Math.round(toNumber(value, 0) * 100) / 100;

const toDateKey = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const withTimeout = async (url, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timer);
  }
};

const cacheGet = (key) => {
  const hit = rateCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt && hit.expiresAt <= Date.now()) {
    rateCache.delete(key);
    return null;
  }
  return hit.value;
};

const cacheSet = (key, value, ttlMs) => {
  rateCache.set(key, {
    value,
    expiresAt: ttlMs ? Date.now() + ttlMs : null,
  });
};

async function fetchRateFromFrankfurter({ from, to, dateKey }) {
  const path = dateKey ? `/${dateKey}` : "/latest";
  const url = `https://api.frankfurter.app${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await withTimeout(url);

  if (!response.ok) {
    throw new Error(`Frankfurter rate fetch failed: ${response.status}`);
  }

  const payload = await response.json();
  const rate = toNumber(payload?.rates?.[to], NaN);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Frankfurter returned invalid FX rate");
  }

  return rate;
}

async function fetchRateFromOpenErApi({ from, to }) {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
  const response = await withTimeout(url);

  if (!response.ok) {
    throw new Error(`OpenERAPI rate fetch failed: ${response.status}`);
  }

  const payload = await response.json();
  const rate = toNumber(payload?.rates?.[to], NaN);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("OpenERAPI returned invalid FX rate");
  }

  return rate;
}

export async function getUsdRate(currency, atDate = null) {
  const from = String(currency || USD).toUpperCase();
  if (from === USD) {
    return {
      rate: 1,
      dateKey: toDateKey(atDate),
      provider: "identity",
    };
  }

  const dateKey = toDateKey(atDate);
  const cacheKey = `${from}->${USD}:${dateKey || "latest"}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const rate = await fetchRateFromFrankfurter({ from, to: USD, dateKey });
    const result = { rate, dateKey, provider: "frankfurter" };
    cacheSet(cacheKey, result, dateKey ? null : LATEST_CACHE_TTL_MS);
    return result;
  } catch {
    const rate = await fetchRateFromOpenErApi({ from, to: USD });
    const result = { rate, dateKey: null, provider: "open-er-api" };
    cacheSet(cacheKey, result, LATEST_CACHE_TTL_MS);
    return result;
  }
}

export async function convertAmountToUsd({ amount, currency, atDate = null }) {
  const sourceAmount = toNumber(amount, NaN);
  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
    return {
      amountUsd: 0,
      exchangeRateToUsd: null,
      exchangeRateDate: toDateKey(atDate),
      conversionProvider: null,
    };
  }

  const fromCurrency = String(currency || USD).toUpperCase();
  if (fromCurrency === USD) {
    return {
      amountUsd: roundCurrency(sourceAmount),
      exchangeRateToUsd: 1,
      exchangeRateDate: toDateKey(atDate),
      conversionProvider: "identity",
    };
  }

  const { rate, dateKey, provider } = await getUsdRate(fromCurrency, atDate);

  return {
    amountUsd: roundCurrency(sourceAmount * rate),
    exchangeRateToUsd: rate,
    exchangeRateDate: dateKey,
    conversionProvider: provider,
  };
}

export async function enrichPaymentsWithUsd(payments = []) {
  if (!Array.isArray(payments) || payments.length === 0) return [];

  const enriched = payments.map((payment) => ({ ...payment }));
  const pendingRatePromises = new Map();

  enriched.forEach((payment) => {
    const existingUsd = Number(payment?.amountUsd);
    if (Number.isFinite(existingUsd) && existingUsd >= 0) return;

    const currency = String(payment?.currency || USD).toUpperCase();
    const dateKey = toDateKey(payment?.createdAt || payment?.updatedAt);
    const key = `${currency}:${dateKey || "latest"}`;

    if (!pendingRatePromises.has(key)) {
      if (currency === USD) {
        pendingRatePromises.set(
          key,
          Promise.resolve({
            rate: 1,
            dateKey,
            provider: "identity",
          })
        );
      } else {
        pendingRatePromises.set(key, getUsdRate(currency, dateKey));
      }
    }
  });

  const resolvedRates = new Map();
  await Promise.all(
    Array.from(pendingRatePromises.entries()).map(async ([key, promise]) => {
      try {
        resolvedRates.set(key, await promise);
      } catch (err) {
        resolvedRates.set(key, null);
      }
    })
  );

  enriched.forEach((payment) => {
    const existingUsd = Number(payment?.amountUsd);
    if (Number.isFinite(existingUsd) && existingUsd >= 0) {
      payment.amountUsd = roundCurrency(existingUsd);
      payment.exchangeRateToUsd = Number(payment?.exchangeRateToUsd) || null;
      payment.exchangeRateDate = payment?.exchangeRateDate || null;
      return;
    }

    const amount = toNumber(payment?.amount, NaN);
    const currency = String(payment?.currency || USD).toUpperCase();
    const dateKey = toDateKey(payment?.createdAt || payment?.updatedAt);

    if (!Number.isFinite(amount) || amount <= 0) {
      payment.amountUsd = 0;
      payment.exchangeRateToUsd = null;
      payment.exchangeRateDate = dateKey;
      return;
    }

    if (currency === USD) {
      payment.amountUsd = roundCurrency(amount);
      payment.exchangeRateToUsd = 1;
      payment.exchangeRateDate = dateKey;
      return;
    }

    const rateInfo = resolvedRates.get(`${currency}:${dateKey || "latest"}`);
    if (rateInfo?.rate) {
      payment.amountUsd = roundCurrency(amount * rateInfo.rate);
      payment.exchangeRateToUsd = rateInfo.rate;
      payment.exchangeRateDate = rateInfo.dateKey;
      return;
    }

    payment.amountUsd = 0;
    payment.exchangeRateToUsd = null;
    payment.exchangeRateDate = dateKey;
  });

  return enriched;
}
