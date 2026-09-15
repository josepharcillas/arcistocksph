// Google News RSS — no API key needed. We run several angled queries per stock
// (general PSE coverage + financial/opinion coverage) and merge the results, so
// signals see more of "what's being said" than a single narrow query returned.
export async function fetchHeadlines(ticker: string, companyName: string): Promise<string[]> {
  const name = companyName || ticker;
  // Anchor on the company name (quoted) rather than the bare ticker — tickers
  // like "SM" or "AC" are hopelessly ambiguous in a global news index.
  const queries = [
    `"${name}" PSE stock Philippines`,
    `"${name}" (shares OR earnings OR profit OR analyst OR outlook)`,
  ];

  const settled = await Promise.allSettled(queries.map(fetchGoogleNewsQuery));
  const all = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  // Dedupe by normalized title (case/whitespace-insensitive), preserving order.
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const title of all) {
    const key = title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(title);
    }
  }

  return merged.slice(0, 10);
}

async function fetchGoogleNewsQuery(query: string): Promise<string[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-PH&gl=PH&ceid=PH:en`;

    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];

    const xml = await res.text();

    // Google News now returns plain `<title>...</title>` (no CDATA wrapper), so
    // match both. The first two titles are the feed header ("… - Google News"
    // and "Google News") — filtered out below.
    return [...xml.matchAll(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)]
      .map((m) => decodeEntities(m[1].trim()))
      .filter((t) => t && !t.includes('Google News'))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
