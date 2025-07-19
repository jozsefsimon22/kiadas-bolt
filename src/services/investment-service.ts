
'use server';

// A simple in-memory cache for the server request lifecycle.
const rateCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL_QUOTE = 1000 * 60 * 5; // 5 minutes for quotes
const CACHE_TTL_SEARCH = 1000 * 60 * 60; // 1 hour for search results

const API_KEY = process.env.TIINGO_API_KEY;

type StockPriceData = {
    price: number;
    change: number;
    changePercent: number;
};

export type StockSearchResult = {
    uniqueKey: string;
    symbol: string;
    name: string;
    type: string;
    region: string;
    currency: string;
}

export type HistoricalDataPoint = {
    date: string;
    close: number;
    volume: number;
}

export type Dividend = {
    date: string;
    amount: number;
}

export type FullHistoricalData = {
    prices: HistoricalDataPoint[];
    dividends: Dividend[];
}


/**
 * Searches for stock symbols and names using the Tiingo API.
 * @param keywords The search keywords.
 * @returns A list of matching stocks.
 */
export async function searchStocks(keywords: string): Promise<StockSearchResult[]> {
  if (!API_KEY) {
      console.error("Tiingo API key is not set.");
      return [];
  }
  if (!keywords || keywords.length < 2) return [];

  const cacheKey = `tiingo-search-${keywords}`;
  const cached = rateCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_SEARCH)) {
    return cached.data;
  }

  try {
    const url = `https://api.tiingo.com/tiingo/utilities/search?query=${keywords}&asset_types=stock,etf&token=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
        console.error(`Tiingo search error for "${keywords}": ${response.statusText}`);
        return [];
    }

    const data = await response.json();
    
    // Tiingo returns a note if the API limit is hit or for other issues
    if (data.detail) {
        console.error(`Tiingo API note for search "${keywords}":`, data.detail);
        return [];
    }

    if (!Array.isArray(data) || data.length === 0) {
      // Sometimes a valid ticker returns an empty array, so we try a direct lookup.
      const directPrice = await getStockPrice(keywords.toUpperCase());
      if (directPrice) {
        return [{
            uniqueKey: keywords.toUpperCase(),
            symbol: keywords.toUpperCase(),
            name: 'Direct Lookup',
            type: 'Unknown',
            region: 'Unknown',
            currency: 'USD'
        }];
      }
      return [];
    }

    const results: StockSearchResult[] = data.map((match, index) => ({
        uniqueKey: `${match['ticker']}-${match['name']}-${index}`,
        symbol: match['ticker'],
        name: match['name'],
        type: match['assetType'],
        region: match['countryCode'],
        currency: 'USD',
    }));

    rateCache.set(cacheKey, { data: results, timestamp: Date.now() });
    return results;

  } catch (error) {
    console.error(`Failed to search for stocks with Tiingo: "${keywords}":`, error);
    return [];
  }
}

/**
 * Fetches the current stock price and change from Tiingo's IEX endpoint.
 * @param ticker The stock symbol (e.g., 'AAPL').
 * @returns The price, change, and change percentage.
 */
export async function getStockPrice(ticker: string): Promise<StockPriceData | null> {
  if (!API_KEY) {
      console.error("Tiingo API key is not set.");
      return null;
  }
  if (!ticker) return null;

  const cacheKey = `tiingo-stock-${ticker}`;
  const cached = rateCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_QUOTE)) {
    return cached.data;
  }

  try {
    const url = `https://api.tiingo.com/iex/?tickers=${ticker}&token=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Tiingo API error for ${ticker}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const quote = data[0];
    
    if (!quote) {
        console.warn(`No data for ticker ${ticker} from Tiingo. It might be invalid or not on IEX.`);
        return { price: 0, change: 0, changePercent: 0 };
    }

    const lastPrice = quote.last ?? quote.tngoLast ?? quote.prevClose ?? 0;
    const prevClose = quote.prevClose ?? lastPrice;
    
    const price = lastPrice;
    const change = lastPrice - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;
    
    const result = { 
        price: isNaN(price) ? 0 : price, 
        change: isNaN(change) ? 0 : change, 
        changePercent: isNaN(changePercent) ? 0 : changePercent 
    };

    rateCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  } catch (error) {
    console.error(`Failed to fetch price for ${ticker} from Tiingo:`, error);
    return null;
  }
}

/**
 * Fetches historical daily data for a stock from Tiingo.
 * @param ticker The stock symbol.
 * @param startDate The start date for the historical data.
 * @returns A list of historical data points.
 */
export async function getHistoricalData(ticker: string, startDate: Date): Promise<FullHistoricalData | null> {
    if (!API_KEY) {
        console.error("Tiingo API key is not set.");
        return null;
    }
    if (!ticker || !startDate) return null;

    const startDateString = startDate.toISOString().split('T')[0];
    const cacheKey = `tiingo-hist-${ticker}-${startDateString}`;
    const cached = rateCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_SEARCH)) {
        return cached.data;
    }

    try {
        const url = `https://api.tiingo.com/tiingo/daily/${ticker}/prices?startDate=${startDateString}&token=${API_KEY}`;
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`Tiingo historical data error for ${ticker}: ${response.statusText}`);
            return { prices: [], dividends: [] };
        }

        const data = await response.json();
        if (data.detail) {
            console.error(`Tiingo API note for historical ${ticker}:`, data.detail);
            return { prices: [], dividends: [] };
        }
        
        const prices: HistoricalDataPoint[] = [];
        const dividends: Dividend[] = [];

        data.forEach((day: any) => {
            prices.push({
                date: day.date,
                close: day.adjClose, // Use adjusted close for splits/dividends
                volume: day.adjVolume,
            });
            if (day.divCash && day.divCash > 0) {
                dividends.push({
                    date: day.date,
                    amount: day.divCash,
                });
            }
        });
        
        const results = { prices, dividends };
        rateCache.set(cacheKey, { data: results, timestamp: Date.now() });
        return results;

    } catch (error) {
        console.error(`Failed to fetch historical data for ${ticker}:`, error);
        return null;
    }
}
