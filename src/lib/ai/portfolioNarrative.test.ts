import { describe, it, expect } from 'vitest';
import { buildNarrativePrompt, parseNarrative, type PortfolioNarrativeInput } from './portfolioNarrative';

const input: PortfolioNarrativeInput = {
  equity: 31000,
  cash: 1244,
  positions: [
    { ticker: 'DMC', weightPct: 37, pnlPct: -26, verdict: 'HOLD', yieldPct: 6.2, nextRecordDate: '2026-07-20' },
    { ticker: 'LTG', weightPct: 27, pnlPct: 39, verdict: 'BUY', yieldPct: null, nextRecordDate: null },
  ],
  actions: [{ kind: 'HOLD_CASH', reason: 'Not enough cash to add.' }],
};

describe('buildNarrativePrompt', () => {
  it('includes positions sorted by weight with dividend context', () => {
    const p = buildNarrativePrompt(input);
    expect(p).toContain('DMC: 37% of book');
    expect(p).toContain('6.2% yield (record date 2026-07-20)');
    expect(p).toContain('P/L +39%'); // LTG winner rendered with sign
    expect(p.indexOf('DMC')).toBeLessThan(p.indexOf('LTG')); // heavier weight first
  });

  it('handles an empty book without throwing', () => {
    const p = buildNarrativePrompt({ equity: 5000, cash: 5000, positions: [], actions: [] });
    expect(p).toContain('(no holdings)');
    expect(p).toContain('(none)');
  });
});

describe('parseNarrative', () => {
  it('extracts summary from clean JSON', () => {
    expect(parseNarrative('{"summary":"Your book is concentrated in DMC."}')).toBe('Your book is concentrated in DMC.');
  });

  it('extracts JSON embedded in prose', () => {
    expect(parseNarrative('Sure!\n{"summary":"Hold the line."}\n')).toBe('Hold the line.');
  });

  it('falls back to raw prose when not JSON', () => {
    expect(parseNarrative('Your portfolio looks concentrated.')).toBe('Your portfolio looks concentrated.');
  });

  it('returns a safe default on empty text', () => {
    expect(parseNarrative('   ')).toContain('could not be generated');
  });

  it('ignores JSON with a non-string or blank summary', () => {
    expect(parseNarrative('{"summary": 42}')).toContain('could not be generated');
    expect(parseNarrative('{"summary": "   "}')).toContain('could not be generated');
  });
});
