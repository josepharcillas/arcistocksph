export async function fetchHeadlines(ticker: string, companyName: string): Promise<string[]> {
  try {
    // Google News RSS — no API key needed
    const query = encodeURIComponent(`${companyName} PSE stock Philippines`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-PH&gl=PH&ceid=PH:en`;

    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];

    const xml = await res.text();

    // Google News now returns plain `<title>...</title>` (no CDATA wrapper), so
    // match both. The first two titles are the feed header ("… - Google News"
    // and "Google News") — filtered out below.
    const titles = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)]
      .map((m) => decodeEntities(m[1].trim()))
      .filter((t) => t && !t.includes('Google News'))
      .slice(0, 8);

    return titles;
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
