import { describe, it, expect } from 'vitest';
import { isSignalCorrect } from './signalAccuracy';

describe('isSignalCorrect', () => {
  it('BUY is correct only when price rose', () => {
    expect(isSignalCorrect('BUY', 0.05)).toBe(true);
    expect(isSignalCorrect('BUY', -0.01)).toBe(false);
    expect(isSignalCorrect('BUY', 0)).toBe(false);
  });

  it('SELL is correct only when price fell', () => {
    expect(isSignalCorrect('SELL', -0.05)).toBe(true);
    expect(isSignalCorrect('SELL', 0.01)).toBe(false);
  });

  it('HOLD is correct only when price stayed within the band', () => {
    expect(isSignalCorrect('HOLD', 0.02)).toBe(true);
    expect(isSignalCorrect('HOLD', -0.02)).toBe(true);
    expect(isSignalCorrect('HOLD', 0.05)).toBe(false);
    expect(isSignalCorrect('HOLD', -0.05)).toBe(false);
  });

  it('respects a custom hold band', () => {
    expect(isSignalCorrect('HOLD', 0.04, 0.05)).toBe(true);
    expect(isSignalCorrect('HOLD', 0.06, 0.05)).toBe(false);
  });
});
