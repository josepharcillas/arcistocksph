import { describe, it, expect } from 'vitest';
import { parseVisionResponse } from './parsePortfolioImage';

describe('parseVisionResponse', () => {
  it('parses a clean web-format response', () => {
    const r = parseVisionResponse(JSON.stringify({
      format: 'web',
      cash: 1244.61,
      positions: [
        { ticker: 'DMC', shares: 1500, avgPrice: 10.6313 },
        { ticker: 'LTG', shares: 600, avgPrice: 10.3789 },
      ],
    }));
    expect(r.format).toBe('web');
    expect(r.cash).toBe(1244.61);
    expect(r.positions).toHaveLength(2);
    expect(r.positions[0]).toEqual({ ticker: 'DMC', shares: 1500, avgPrice: 10.6313 });
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const r = parseVisionResponse('Here you go:\n{"format":"mobile","cash":null,"positions":[{"ticker":"nikl","shares":2500,"avgPrice":5.9946}]}\nDone');
    expect(r.format).toBe('mobile');
    expect(r.cash).toBeNull();
    expect(r.positions[0].ticker).toBe('NIKL'); // uppercased
  });

  it('strips a .PS suffix and rounds fractional shares', () => {
    const r = parseVisionResponse('{"positions":[{"ticker":"SMC.PS","shares":10.4,"avgPrice":135.46}]}');
    expect(r.positions[0].ticker).toBe('SMC');
    expect(r.positions[0].shares).toBe(10);
  });

  it('drops positions with invalid ticker, shares, or price', () => {
    const r = parseVisionResponse(JSON.stringify({
      positions: [
        { ticker: 'DMC', shares: 1500, avgPrice: 10.63 },   // valid
        { ticker: 'TOOLONGTICKER', shares: 100, avgPrice: 5 }, // bad ticker
        { ticker: 'DITO', shares: 0, avgPrice: 7.56 },        // zero shares
        { ticker: 'LTG', shares: 600, avgPrice: -1 },         // negative price
        { ticker: '', shares: 100, avgPrice: 5 },             // empty ticker
      ],
    }));
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0].ticker).toBe('DMC');
  });

  it('rejects negative cash', () => {
    const r = parseVisionResponse('{"cash":-50,"positions":[{"ticker":"DMC","shares":100,"avgPrice":10}]}');
    expect(r.cash).toBeNull();
  });

  it('returns an empty result on non-JSON text', () => {
    const r = parseVisionResponse('the model refused');
    expect(r.positions).toHaveLength(0);
    expect(r.cash).toBeNull();
    expect(r.format).toBe('unknown');
  });

  it('defaults an unrecognized format to unknown', () => {
    const r = parseVisionResponse('{"format":"tablet","positions":[{"ticker":"DMC","shares":100,"avgPrice":10}]}');
    expect(r.format).toBe('unknown');
  });
});
