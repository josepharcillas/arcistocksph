export async function fetchHeadlines(ticker: string, companyName: string): Promise<string[]> {
  try {
    // Google News RSS — no API key needed
    const query = encodeURIComponent(`${companyName} PSE stock Philippines`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-PH&gl=PH&ceid=PH:en`;

    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];

    const xml = await res.text();
    const titles = [...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)]
      .map(m => m[1])
      .filter(t => !t.includes('Google News'))
      .slice(0, 8);

    return titles;
  } catch {
    return [];
  }
}
