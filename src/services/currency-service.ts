
'use server';

// A simple in-memory cache for the server request lifecycle.
// Note: This cache is per-request in a serverless environment.
const rateCache = new Map<string, { rate: number, timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

/**
 * Fetches the conversion rate between two currencies using the Frankfurter API.
 * @param from The currency to convert from (e.g., 'USD').
 * @param to The currency to convert to (e.g., 'EUR').
 * @returns The conversion rate.
 */
export async function getConversionRate(from: string, to: string): Promise<number> {
  if (!from || !to || from === to) {
    return 1;
  }

  const cacheKey = `${from}-${to}`;
  const cached = rateCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.rate;
  }

  try {
    // Use 'latest' to get the most recent data.
    const response = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    if (!response.ok) {
      console.error(`Currency API error for ${from}->${to}: ${response.statusText}`);
      return 1; // Fallback to a 1:1 rate on failure.
    }

    const data = await response.json();
    const rate = data.rates?.[to];

    if (typeof rate !== 'number') {
      console.error(`Invalid rate format received for ${from}->${to}`, data);
      return 1;
    }
    
    rateCache.set(cacheKey, { rate, timestamp: Date.now() });
    return rate;
  } catch (error) {
    console.error(`Failed to fetch conversion rate for ${from}->${to}:`, error);
    return 1; // Fallback
  }
}
