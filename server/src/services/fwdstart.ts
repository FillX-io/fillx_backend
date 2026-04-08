// FwdStart Newsletter RSS scraper service
// Scrapes https://www.fwdstart.me/archive and returns RSS XML

interface FeedItem {
  title: string;
  link: string;
  date: string;
  description: string;
}

interface CacheEntry {
  data: string;
  timestamp: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL = 1_800_000; // 30 minutes

export async function fetchFwdStartRss(): Promise<string> {
  const now = Date.now();

  if (cache && now - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  const response = await fetch('https://www.fwdstart.me/archive', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const items: FeedItem[] = [];
  const seenUrls = new Set<string>();

  // Split by embla__slide to get each post block
  const slideBlocks = html.split('embla__slide');

  for (const block of slideBlocks) {
    // Extract URL
    const urlMatch = block.match(/href="(\/p\/[^"]+)"/);
    if (!urlMatch) continue;

    const url = `https://www.fwdstart.me${urlMatch[1]}`;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    // Extract title from alt attribute
    const altMatch = block.match(/alt="([^"]+)"/);
    const title = altMatch ? altMatch[1] : '';
    if (!title || title.length < 5) continue;

    // Extract date - look for "Mon DD, YYYY" pattern
    const dateMatch = block.match(
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i
    );
    let pubDate = new Date();
    if (dateMatch) {
      const dateStr = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`;
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        pubDate = parsed;
      }
    }

    // Extract subtitle/description if available
    let description = '';
    const subtitleMatch = block.match(
      /line-clamp-3[^>]*>.*?<span[^>]*>([^<]{20,})<\/span>/s
    );
    if (subtitleMatch) {
      description = subtitleMatch[1].trim();
    }

    items.push({
      title,
      link: url,
      date: pubDate.toISOString(),
      description,
    });
  }

  // Build RSS XML
  const rssItems = items
    .slice(0, 30)
    .map(
      (item) => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <guid>${item.link}</guid>
      <pubDate>${new Date(item.date).toUTCString()}</pubDate>
      <description><![CDATA[${item.description}]]></description>
      <source url="https://www.fwdstart.me">FwdStart Newsletter</source>
    </item>`
    )
    .join('');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>FwdStart Newsletter</title>
    <link>https://www.fwdstart.me</link>
    <description>Forward-thinking startup and VC news from MENA and beyond</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="https://worldmonitor.app/api/fwdstart" rel="self" type="application/rss+xml"/>
    ${rssItems}
  </channel>
</rss>`;

  cache = { data: rss, timestamp: now };

  return rss;
}
