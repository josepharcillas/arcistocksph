import { describe, it, expect } from 'vitest';
import { parseDividendDetail } from './market/dividendDisclosures';

const base = (amountHtml: string) => `
<span id="companyStockSymbol">EMI</span>
<ul class="reportType"><li><input type="radio" value="COMMON" checked="checked" /></li></ul>
<tr><th>Amount of Cash Dividend Per Share</th><td><span class="valInput ">${amountHtml}</span></td></tr>
`;

describe('parseDividendDetail amount extraction', () => {
  it('takes the parenthesized figure, not decoy numbers in words', () => {
    expect(parseDividendDetail(base('Thirteen and 51/100 centavos (Php0.1351) per share')).rawAmount).toBeCloseTo(0.1351);
  });
  it('handles a plain Php figure', () => {
    expect(parseDividendDetail(base('Php5.00')).rawAmount).toBe(5);
  });
  it('handles a peso-sign figure', () => {
    expect(parseDividendDetail(base('₱2.50 per share')).rawAmount).toBe(2.5);
  });
  it('handles USD figures', () => {
    const d = parseDividendDetail(base('US$0.0125 per share'));
    expect(d.currency).toBe('USD');
    expect(d.rawAmount).toBeCloseTo(0.0125);
  });
  it('falls back to a bare number when untagged', () => {
    expect(parseDividendDetail(base('0.30')).rawAmount).toBe(0.3);
  });
});
