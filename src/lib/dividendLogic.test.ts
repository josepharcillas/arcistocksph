import { describe, it, expect } from 'vitest';
import { ttmDividendPerShare, nextUpcomingDividend, entryRating, dedupeDividendEvents } from './dividendLogic';
import { parseDividendDetail, parseDisclosureList, parseEdgeDay } from './market/dividendDisclosures';

const NOW = new Date('2026-07-05T12:00:00+08:00');

describe('ttmDividendPerShare', () => {
  it('sums dividends with record dates inside the trailing 12 months', () => {
    const rows = [
      { amount: 2, recordDate: '2026-03-10' },
      { amount: 1.5, recordDate: '2025-09-01' },
      { amount: 3, recordDate: '2025-06-01' },   // > 12 months ago — out
      { amount: 1, recordDate: '2026-07-20' },   // future record date — out of TTM
    ];
    expect(ttmDividendPerShare(rows, NOW)).toBeCloseTo(3.5);
  });

  it('falls back to payment date when record date is missing', () => {
    expect(ttmDividendPerShare([{ amount: 2, recordDate: null, paymentDate: '2026-01-15' }], NOW)).toBe(2);
    expect(ttmDividendPerShare([{ amount: 2, recordDate: null, paymentDate: null }], NOW)).toBe(0);
  });

  it('ignores non-positive amounts', () => {
    expect(ttmDividendPerShare([{ amount: 0, recordDate: '2026-01-15' }], NOW)).toBe(0);
  });
});

describe('dedupeDividendEvents', () => {
  it('collapses duplicate filings of the same dividend, keeping the newest', () => {
    const rows = [
      { edgeNo: 'a', amount: 0.1, securityType: 'COMMON', recordDate: '2026-05-29', divType: null, announcedAt: '2026-05-14T23:44:00Z' },
      { edgeNo: 'b', amount: 0.1, securityType: 'COMMON', recordDate: '2026-05-29', divType: 'Regular', announcedAt: '2026-05-18T00:39:00Z' },
    ];
    const out = dedupeDividendEvents(rows);
    expect(out).toHaveLength(1);
    expect(out[0].edgeNo).toBe('b'); // newest announce wins
  });

  it('keeps genuinely different events (different record dates / amounts)', () => {
    const rows = [
      { amount: 0.1, securityType: 'COMMON', recordDate: '2026-05-29' },
      { amount: 0.1, securityType: 'COMMON', recordDate: '2026-11-29' }, // later semester
      { amount: 0.5, securityType: 'COMMON', recordDate: '2026-05-29', divType: 'Special' }, // special same date
    ];
    expect(dedupeDividendEvents(rows)).toHaveLength(3);
  });

  it('collapses an adjacent-date re-filing but keeps genuinely separate monthly payouts', () => {
    // AREIT case: same ₱0.62 filed on 05-27 (untyped re-file) and 05-28 (Regular),
    // plus a real next-month payout — the first two are one event, the third isn't.
    const out = dedupeDividendEvents([
      { amount: 0.62, securityType: 'COMMON', recordDate: '2026-05-27', divType: null, announcedAt: '2026-05-20T00:00:00Z' },
      { amount: 0.62, securityType: 'COMMON', recordDate: '2026-05-28', divType: 'Regular', announcedAt: '2026-05-21T00:00:00Z' },
      { amount: 0.62, securityType: 'COMMON', recordDate: '2026-06-27', divType: 'Regular', announcedAt: '2026-06-20T00:00:00Z' },
    ]);
    expect(out).toHaveLength(2);                 // re-file merged, monthly kept
    const may = out.find((r) => r.recordDate!.startsWith('2026-05'));
    expect(may!.divType).toBe('Regular');        // the typed filing represents the cluster
    expect(ttmDividendPerShare(out, new Date('2026-07-05T12:00:00+08:00'))).toBeCloseTo(1.24); // 0.62 × 2, not × 3
  });

  it('keeps rows without a record date (cannot match safely)', () => {
    const rows = [
      { amount: 0.1, recordDate: null },
      { amount: 0.1, recordDate: null },
    ];
    expect(dedupeDividendEvents(rows)).toHaveLength(2);
  });

  it('ttm reflects a single payout after dedup', () => {
    const rows = dedupeDividendEvents([
      { amount: 0.1, securityType: 'COMMON', recordDate: '2026-05-29', announcedAt: '2026-05-14T00:00:00Z' },
      { amount: 0.1, securityType: 'COMMON', recordDate: '2026-05-29', announcedAt: '2026-05-18T00:00:00Z' },
    ]);
    expect(ttmDividendPerShare(rows, NOW)).toBeCloseTo(0.1);
  });
});

describe('nextUpcomingDividend', () => {
  it('returns the soonest future record date', () => {
    const rows = [
      { amount: 1, recordDate: '2026-08-20' },
      { amount: 2, recordDate: '2026-07-17' },
      { amount: 3, recordDate: '2026-06-01' }, // past
    ];
    expect(nextUpcomingDividend(rows, NOW)?.recordDate).toBe('2026-07-17');
  });

  it('returns null when nothing is scheduled', () => {
    expect(nextUpcomingDividend([{ amount: 1, recordDate: '2026-01-01' }], NOW)).toBeNull();
  });
});

describe('entryRating', () => {
  it('AVOIDs on a SELL verdict regardless of yield', () => {
    const r = entryRating({ yieldPct: 12, verdict: 'SELL', rsi14: 30, now: NOW });
    expect(r.rating).toBe('AVOID');
  });

  it('WAITs below the yield threshold', () => {
    expect(entryRating({ yieldPct: 2.5, verdict: 'BUY', now: NOW }).rating).toBe('WAIT');
  });

  it('STRONG ENTRY on fat yield + oversold + BUY signal', () => {
    const r = entryRating({ yieldPct: 7, rsi14: 35, verdict: 'BUY', aboveSma200: true, now: NOW });
    expect(r.rating).toBe('STRONG ENTRY');
    expect(r.score).toBeGreaterThanOrEqual(5);
  });

  it('upcoming record date within 30 days adds a point', () => {
    const base = entryRating({ yieldPct: 6.5, rsi14: 45, now: NOW });
    const withNext = entryRating({ yieldPct: 6.5, rsi14: 45, nextRecordDate: '2026-07-17', now: NOW });
    expect(withNext.score).toBe(base.score + 1);
  });

  it('overbought RSI subtracts a point', () => {
    const hot = entryRating({ yieldPct: 6.5, rsi14: 75, now: NOW });
    const neutral = entryRating({ yieldPct: 6.5, rsi14: 60, now: NOW });
    expect(hot.score).toBe(neutral.score - 1);
  });

  it('respects a custom minimum yield', () => {
    expect(entryRating({ yieldPct: 3.5, minYieldPct: 3, rsi14: 38, verdict: 'BUY', now: NOW }).rating).not.toBe('WAIT');
  });
});

// Real HTML shapes captured from PSE Edge on 2026-07-05.
const DETAIL_HTML = `
<span id="companyName">Ayala Corporation</span>
<span id="companyStockSymbol">AC</span>
<td>C05077-2026</td>
<h4>PSE Disclosure Form 6-1 - Declaration of Cash Dividends</h4>
<ul class="reportType">
  <li><input readonly="readonly" disabled="disabled" type="radio" name="TypeSecurities21" value="COMMON" data-type="RADIO" checked="checked" /><span>Common</span></li>
  <li><input readonly="readonly" disabled="disabled" type="radio" name="TypeSecurities22" value="PREFERRED" data-type="RADIO" /><span>Preferred</span><span class="valInput ">-</span></li>
</ul>
<tr><th>Type (Regular or Special)</th><td><span class="valInput ">Regular</span></td></tr>
<tr><th>Amount of Cash Dividend Per Share</th><td><span class="valInput ">Php5.00</span></td></tr>
<tr><th>Record Date</th><td><span class="valInput ">Jul 17, 2026</span></td></tr>
<tr><th>Payment Date</th><td><span class="valInput ">Jul 31, 2026</span></td></tr>
`;

describe('parseDividendDetail', () => {
  it('parses the Form 6-1 fields', () => {
    const d = parseDividendDetail(DETAIL_HTML);
    expect(d.ticker).toBe('AC');
    expect(d.companyName).toBe('Ayala Corporation');
    expect(d.circularNo).toBe('C05077-2026');
    expect(d.securityType).toBe('COMMON');
    expect(d.divType).toBe('Regular');
    expect(d.rawAmount).toBe(5);
    expect(d.currency).toBe('PHP');
    expect(d.recordDate).toBe('2026-07-17');
    expect(d.paymentDate).toBe('2026-07-31');
  });

  it('detects PREFERRED declarations and USD amounts', () => {
    const html = DETAIL_HTML
      .replace('value="COMMON" data-type="RADIO" checked="checked"', 'value="COMMON" data-type="RADIO"')
      .replace('value="PREFERRED" data-type="RADIO"', 'value="PREFERRED" data-type="RADIO" checked="checked"')
      .replace('Php5.00', 'US$0.0125');
    const d = parseDividendDetail(html);
    expect(d.securityType).toBe('PREFERRED');
    expect(d.currency).toBe('USD');
    expect(d.rawAmount).toBeCloseTo(0.0125);
  });

  it('treats TBA dates as null', () => {
    const d = parseDividendDetail(DETAIL_HTML.replace('Jul 31, 2026', 'TBA'));
    expect(d.paymentDate).toBeNull();
  });
});

const LIST_HTML = `
<span class="count">[1 / 20]
[Total 980]
</span>
<tbody>
  <tr>
      <td><a href="#viewer" onclick="openPopup('94c955dd7c7c5c7064d70b69f0a3140b');return false;">Declaration of Cash Dividends</a></td>
      <td class="alignC">Jul 03, 2026 01:47 PM</td>
      <td class="alignC">6-1</td>
      <td class="alignC">
      C05077-2026</td>
    </tr>
  <tr>
      <td><a href="#viewer" onclick="openPopup('6cb1dddf88e1439664d70b69f0a3140b');return false;">[Amend-1]Declaration of Cash Dividends</a></td>
      <td class="alignC">Jul 01, 2026 07:39 AM</td>
      <td class="alignC">6-1</td>
      <td class="alignC">
      C04959-2026</td>
    </tr>
</tbody>
`;

describe('parseDisclosureList', () => {
  it('parses total, edge numbers, dates and amend flags', () => {
    const { total, rows } = parseDisclosureList(LIST_HTML);
    expect(total).toBe(980);
    expect(rows).toHaveLength(2);
    expect(rows[0].edgeNo).toBe('94c955dd7c7c5c7064d70b69f0a3140b');
    expect(rows[0].circularNo).toBe('C05077-2026');
    expect(rows[0].isAmend).toBe(false);
    expect(rows[0].announcedAt).toBe('2026-07-03T13:47:00+08:00');
    expect(rows[1].isAmend).toBe(true);
  });
});

describe('parseEdgeDay', () => {
  it('converts PSE Edge day strings', () => {
    expect(parseEdgeDay('Jul 17, 2026')).toBe('2026-07-17');
    expect(parseEdgeDay('')).toBeNull();
  });
});
