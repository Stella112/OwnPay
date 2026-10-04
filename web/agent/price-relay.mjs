// Public market-data relay for the OwnPay testnet stock desk.
// Source: Yahoo Finance's public chart endpoint (unofficial, no key). We take the
// latest 1-minute candle including pre/post market, and keep the MARKET'S quote
// time. Outside trading sessions that time stops moving, so the desk correctly
// treats the price as stale and purchases queue until the next session.

export const DESK_STOCKS = {
  TSLA: '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
  AMD: '0x71178BAc73cBeb415514eB542a8995b82669778d',
  AMZN: '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
  NFLX: '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
  PLTR: '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0',
};

/** Parse a Yahoo chart response into { price, quoteTime } (latest non-null candle). */
export function parseChart(json, symbol) {
  const res = json?.chart?.result?.[0];
  if (!res) throw new Error(`no chart data for ${symbol}`);
  const ts = res.timestamp || [];
  const closes = res.indicators?.quote?.[0]?.close || [];
  for (let i = ts.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return { symbol, price: c, quoteTime: ts[i] };
  }
  const m = res.meta;
  if (m && m.regularMarketPrice > 0 && m.regularMarketTime > 0) return { symbol, price: m.regularMarketPrice, quoteTime: m.regularMarketTime };
  throw new Error(`no usable quote for ${symbol}`);
}

export async function fetchQuote(symbol, fetchImpl = fetch) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`;
  const r = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 OwnPay-testnet-relay' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`quote ${symbol}: HTTP ${r.status}`);
  return parseChart(await r.json(), symbol);
}

/** USD price -> 8-decimal integer used by the desk. */
export const toUsd8 = (price) => {
  if (!(price > 0) || !Number.isFinite(price)) throw new Error('invalid price');
  return BigInt(Math.round(price * 1e8));
};
