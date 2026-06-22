import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchFundamentalsApi } from './fundamentalsApi';

const origFetch = global.fetch;
const origKey = process.env.FUNDAMENTALS_API_KEY;
const origProvider = process.env.FUNDAMENTALS_PROVIDER;

afterEach(() => {
  global.fetch = origFetch;
  if (origKey === undefined) delete process.env.FUNDAMENTALS_API_KEY; else process.env.FUNDAMENTALS_API_KEY = origKey;
  if (origProvider === undefined) delete process.env.FUNDAMENTALS_PROVIDER; else process.env.FUNDAMENTALS_PROVIDER = origProvider;
  vi.restoreAllMocks();
});

describe('fetchFundamentalsApi', () => {
  it('is a no-op (no network) when no API key is set', async () => {
    delete process.env.FUNDAMENTALS_API_KEY;
    const spy = vi.fn();
    global.fetch = spy as any;
    const out = await fetchFundamentalsApi('SM');
    expect(out).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('parses EODHD Highlights into P/E, EPS, and dividend yield (%)', async () => {
    process.env.FUNDAMENTALS_API_KEY = 'test';
    process.env.FUNDAMENTALS_PROVIDER = 'eodhd';
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ Highlights: { PERatio: 12.5, EarningsShare: 4.2, DividendYield: 0.035, MarketCapitalization: 1e9 } }),
    })) as any;

    const out = await fetchFundamentalsApi('SM');
    expect(out.pe).toBeCloseTo(12.5);
    expect(out.eps).toBeCloseTo(4.2);
    expect(out.dividendYield).toBeCloseTo(3.5); // 0.035 decimal → 3.5%
    expect(out.marketCap).toBe(1e9);
  });

  it('maps the PSE symbol and returns {} on a non-OK response', async () => {
    process.env.FUNDAMENTALS_API_KEY = 'test';
    process.env.FUNDAMENTALS_PROVIDER = 'eodhd';
    let calledUrl = '';
    global.fetch = vi.fn(async (url: string) => { calledUrl = url; return { ok: false, json: async () => ({}) }; }) as any;

    const out = await fetchFundamentalsApi('sm.ps');
    expect(calledUrl).toContain('/fundamentals/SM.PSE'); // normalized + .PSE suffix
    expect(out).toEqual({});
  });

  it('never throws — returns {} when the provider call rejects', async () => {
    process.env.FUNDAMENTALS_API_KEY = 'test';
    global.fetch = vi.fn(async () => { throw new Error('network down'); }) as any;
    await expect(fetchFundamentalsApi('SM')).resolves.toEqual({});
  });
});
