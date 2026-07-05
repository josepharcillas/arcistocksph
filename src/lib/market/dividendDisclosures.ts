// Cash-dividend declarations from PSE Edge (Disclosure Form 6-1) — the free,
// authoritative source (PSE Edge doesn't expose dividend yield anywhere, but
// every listed company MUST file its cash dividends here). Flow:
//   search.ax (list, date-desc) -> openDiscViewer.do (edge_no -> file_id)
//   -> downloadHtml.do (the actual form) -> parse -> upsert into `dividends`.
// Parse functions are pure (HTML string in, fields out) so they're unit-testable.
import { createSupabaseAdmin } from '../supabase-admin';

const BASE = 'https://edge.pse.com.ph';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const THROTTLE_MS = Number(process.env.DIVIDEND_SYNC_DELAY_MS ?? 300);

export interface DisclosureListRow {
  edgeNo: string;
  templateName: string; // "Declaration of Cash Dividends" or "[Amend-1]Declaration..."
  announcedAt: string;  // ISO
  circularNo: string | null;
  isAmend: boolean;
}

export interface DividendDetail {
  ticker: string | null;
  companyName: string | null;
  circularNo: string | null;
  divType: string | null;       // Regular | Special
  securityType: 'COMMON' | 'PREFERRED' | 'OTHERS' | null;
  rawAmount: number | null;     // as declared, in `currency`
  currency: 'PHP' | 'USD';
  recordDate: string | null;    // YYYY-MM-DD
  paymentDate: string | null;   // YYYY-MM-DD
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "Jul 03, 2026 01:47 PM" (PHT) -> ISO. PSE Edge timestamps are Manila time.
function parseEdgeDate(s: string): string | null {
  const m = s.trim().match(/^(\w{3}) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) (AM|PM))?$/);
  if (!m) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months.indexOf(m[1]);
  if (mon < 0) return null;
  let hh = Number(m[4] ?? 0);
  if (m[6] === 'PM' && hh !== 12) hh += 12;
  if (m[6] === 'AM' && hh === 12) hh = 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${m[3]}-${pad(mon + 1)}-${pad(Number(m[2]))}T${pad(hh)}:${pad(Number(m[5] ?? 0))}:00+08:00`;
}

// "Jul 17, 2026" -> "2026-07-17"; "TBA"/"-"/blank -> null.
export function parseEdgeDay(s: string | null | undefined): string | null {
  if (!s) return null;
  const iso = parseEdgeDate(s.trim());
  return iso ? iso.slice(0, 10) : null;
}

/** Parse one page of the disclosure search results (HTML fragment). */
export function parseDisclosureList(html: string): { total: number; rows: DisclosureListRow[] } {
  const total = Number(html.match(/\[Total (\d+)\]/)?.[1] ?? 0);
  const rows: DisclosureListRow[] = [];
  const rowRe = /openPopup\('([0-9a-f]+)'\);return false;">([^<]+)<\/a><\/td>\s*<td class="alignC">([^<]+)<\/td>\s*<td class="alignC">[^<]*<\/td>\s*<td class="alignC">\s*([^<]*?)\s*<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const announcedAt = parseEdgeDate(m[3]);
    if (!announcedAt) continue;
    const templateName = m[2].trim();
    rows.push({
      edgeNo: m[1],
      templateName,
      announcedAt,
      circularNo: m[4].trim() || null,
      isAmend: templateName.startsWith('[Amend'),
    });
  }
  return { total, rows };
}

/** Parse the Form 6-1 document HTML into structured dividend fields. */
export function parseDividendDetail(html: string): DividendDetail {
  const clean = html.replace(/&nbsp;/g, ' ');
  const ticker = clean.match(/id="companyStockSymbol"[^>]*>\s*([^<]+?)\s*</)?.[1] ?? null;
  const companyName = clean.match(/id="companyName"[^>]*>\s*([^<]+?)\s*</)?.[1] ?? null;
  const circularNo = clean.match(/>\s*(C\d{4,6}-\d{4})\s*</)?.[1] ?? null;

  // Field values sit in <span class="valInput"> after the label's <th>.
  const field = (label: string): string | null => {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,300}?valInput[^>]*>\\s*([^<]+?)\\s*<', 'i');
    const v = clean.match(re)?.[1]?.trim();
    return v && v !== '-' && !/^(N\/?A|TBA|TBD)$/i.test(v) ? v : null;
  };

  const securityType: DividendDetail['securityType'] =
    /<input[^>]*value="COMMON"[^>]*checked/i.test(clean) ? 'COMMON'
    : /<input[^>]*value="PREFERRED"[^>]*checked/i.test(clean) ? 'PREFERRED'
    : /<input[^>]*value="OTHERS?"[^>]*checked/i.test(clean) ? 'OTHERS'
    : null;

  const amountText = field('Amount of Cash Dividend Per Share');
  let rawAmount: number | null = null;
  let currency: 'PHP' | 'USD' = 'PHP';
  if (amountText) {
    if (/US\s?\$|USD/i.test(amountText)) currency = 'USD';
    // Prefer a currency-tagged figure: filings often spell the amount in words
    // with the number in parentheses, e.g. "Thirteen and 51/100 centavos
    // (Php0.1351) per share" — a bare "first number" grab would take the 51.
    const tagged = amountText.match(/(?:Php|PHP|₱|US\s?\$|USD|P)\s*([\d,]+(?:\.\d+)?)/i);
    const n = tagged?.[1] ?? amountText.match(/([\d,]+(?:\.\d+)?)/)?.[1];
    rawAmount = n ? parseFloat(n.replace(/,/g, '')) : null;
    if (rawAmount != null && !(rawAmount > 0)) rawAmount = null;
  }

  return {
    ticker: ticker?.toUpperCase() ?? null,
    companyName,
    circularNo,
    divType: (() => {
      const v = field('Type (Regular or Special)');
      return v ? (/special/i.test(v) ? 'Special' : 'Regular') : null;
    })(),
    securityType,
    rawAmount,
    currency,
    recordDate: parseEdgeDay(field('Record Date')),
    paymentDate: parseEdgeDay(field('Payment Date')),
  };
}

function mmddyyyy(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
}

async function fetchListPage(pageNo: number, fromDate?: Date, toDate?: Date): Promise<{ total: number; rows: DisclosureListRow[] }> {
  const body = new URLSearchParams({
    keyword: '', tmplNm: 'Declaration of Cash Dividends',
    sortType: 'date', dateSortType: 'DESC', cmpySortType: 'ASC', itemSortType: 'ASC',
    fromDate: fromDate ? mmddyyyy(fromDate) : '', toDate: toDate ? mmddyyyy(toDate) : '',
    pageNo: String(pageNo),
  });
  const res = await fetch(`${BASE}/companyDisclosures/search.ax`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`PSE Edge disclosure search failed: ${res.status}`);
  return parseDisclosureList(await res.text());
}

async function fetchDetail(edgeNo: string): Promise<DividendDetail | null> {
  const viewerRes = await fetch(`${BASE}/openDiscViewer.do?edge_no=${edgeNo}`, { headers: { 'User-Agent': UA } });
  if (!viewerRes.ok) return null;
  const fileId = (await viewerRes.text()).match(/downloadHtml\.do\?file_id=(\d+)/)?.[1];
  if (!fileId) return null;
  const docRes = await fetch(`${BASE}/downloadHtml.do?file_id=${fileId}`, {
    headers: { 'User-Agent': UA, Referer: `${BASE}/openDiscViewer.do?edge_no=${edgeNo}` },
  });
  if (!docRes.ok) return null;
  return parseDividendDetail(await docRes.text());
}

// USD-declared dividends (a handful of PSE names) get converted to PHP so TTM
// sums stay in one currency. Free no-key rate with an env/static fallback.
let usdPhpCache: { rate: number; at: number } | null = null;
async function usdPhpRate(): Promise<number> {
  if (usdPhpCache && Date.now() - usdPhpCache.at < 24 * 3600_000) return usdPhpCache.rate;
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=PHP', { headers: { Accept: 'application/json' } });
    const rate = (await res.json())?.rates?.PHP;
    if (rate > 0) { usdPhpCache = { rate, at: Date.now() }; return rate; }
  } catch { /* fall through */ }
  return Number(process.env.USDPHP_RATE ?? 58.5);
}

export interface DividendSyncResult {
  ok: true;
  pagesScanned: number;
  seen: number;
  inserted: number;
  skippedKnown: number;
  skippedUnparsed: number;
  errors: number;
  oldestSeen: string | null;
}

/** Pull cash-dividend disclosures into the `dividends` table.
 *  Incremental (default): walk date-desc pages, stop once a full page is
 *  already known. Backfill: pass `sinceDays` to walk until that cutoff. */
export async function syncDividends(opts: { sinceDays?: number; maxPages?: number } = {}): Promise<DividendSyncResult> {
  const admin = createSupabaseAdmin();
  const cutoff = opts.sinceDays ? new Date(Date.now() - opts.sinceDays * 86400_000) : null;
  const maxPages = opts.maxPages ?? (opts.sinceDays ? 80 : 3);
  const fromDate = cutoff ?? undefined;

  let pagesScanned = 0, seen = 0, inserted = 0, skippedKnown = 0, skippedUnparsed = 0, errors = 0;
  let oldestSeen: string | null = null;

  outer: for (let page = 1; page <= maxPages; page++) {
    const { rows } = await fetchListPage(page, fromDate, fromDate ? new Date() : undefined);
    if (rows.length === 0) break;
    pagesScanned++;

    const known = new Set(
      ((await admin.from('dividends').select('edge_no').in('edge_no', rows.map((r) => r.edgeNo))).data ?? [])
        .map((r: any) => r.edge_no as string),
    );

    let newOnPage = 0;
    for (const row of rows) {
      seen++;
      oldestSeen = row.announcedAt;
      if (cutoff && new Date(row.announcedAt) < cutoff) break outer;
      if (known.has(row.edgeNo)) { skippedKnown++; continue; }
      newOnPage++;

      try {
        await sleep(THROTTLE_MS);
        const d = await fetchDetail(row.edgeNo);
        if (!d?.ticker || d.rawAmount == null) { skippedUnparsed++; continue; }

        const amountPhp = d.currency === 'USD' ? d.rawAmount * (await usdPhpRate()) : d.rawAmount;

        // An amendment supersedes the original filing: drop earlier rows for the
        // same ticker+security that share the record date or the amount (dates
        // are what amendments usually move).
        if (row.isAmend) {
          if (d.recordDate) {
            await admin.from('dividends').delete()
              .eq('ticker', d.ticker).eq('security_type', d.securityType ?? 'COMMON')
              .eq('record_date', d.recordDate).neq('edge_no', row.edgeNo);
          }
          await admin.from('dividends').delete()
            .eq('ticker', d.ticker).eq('security_type', d.securityType ?? 'COMMON')
            .eq('raw_amount', d.rawAmount).neq('edge_no', row.edgeNo)
            .gte('announced_at', new Date(new Date(row.announcedAt).getTime() - 60 * 86400_000).toISOString());
        }

        const { error } = await admin.from('dividends').upsert({
          edge_no: row.edgeNo,
          circular_no: d.circularNo ?? row.circularNo,
          ticker: d.ticker,
          company_name: d.companyName,
          amount: amountPhp,
          raw_amount: d.rawAmount,
          currency: d.currency,
          div_type: d.divType,
          security_type: d.securityType,
          record_date: d.recordDate,
          payment_date: d.paymentDate,
          announced_at: row.announcedAt,
        });
        if (error) { errors++; console.warn('[dividends] upsert failed', row.edgeNo, error.message); }
        else inserted++;
      } catch (err) {
        errors++;
        console.warn('[dividends] detail failed', row.edgeNo, err instanceof Error ? err.message : err);
      }
    }

    // Incremental mode: a page with nothing new means we've caught up.
    if (!cutoff && newOnPage === 0) break;
    await sleep(THROTTLE_MS);
  }

  return { ok: true, pagesScanned, seen, inserted, skippedKnown, skippedUnparsed, errors, oldestSeen };
}
