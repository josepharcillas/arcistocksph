import { describe, it, expect } from 'vitest';
import { parseAIResponse } from './prompt';

describe('parseAIResponse', () => {
  it('parses a clean JSON response', () => {
    const r = parseAIResponse('{"verdict":"BUY","confidence":"HIGH","rationale":"Strong uptrend.","targetPrice":120,"stopLoss":95}');
    expect(r.verdict).toBe('BUY');
    expect(r.confidence).toBe('HIGH');
    expect(r.targetPrice).toBe(120);
    expect(r.stopLoss).toBe(95);
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const r = parseAIResponse('Here is my analysis:\n{"verdict":"SELL","confidence":"MEDIUM","rationale":"Overbought."}\nThanks!');
    expect(r.verdict).toBe('SELL');
    expect(r.targetPrice).toBeNull();
  });

  it('falls back to HOLD/LOW on non-JSON text', () => {
    const r = parseAIResponse('the model refused to answer');
    expect(r.verdict).toBe('HOLD');
    expect(r.confidence).toBe('LOW');
  });

  it('coerces an invalid verdict to HOLD', () => {
    const r = parseAIResponse('{"verdict":"MAYBE","confidence":"HIGH","rationale":"x"}');
    expect(r.verdict).toBe('HOLD');
  });

  it('always stamps an ISO analyzedAt timestamp', () => {
    const r = parseAIResponse('{"verdict":"BUY","confidence":"LOW","rationale":"x"}');
    expect(() => new Date(r.analyzedAt).toISOString()).not.toThrow();
  });
});
