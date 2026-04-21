/**
 * RSS Proxy Service
 * Proxies RSS feed requests with domain allowlist, redirect handling,
 * and in-memory caching (5 min TTL) with request coalescing.
 */

// ── In-memory cache ──
interface RssCacheEntry {
  result: RssProxyResult;
  expiresAt: number;
}
const rssCache = new Map<string, RssCacheEntry>();
const RSS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const inflight = new Map<string, Promise<RssProxyResult | RssProxyError>>();

// Cleanup stale entries every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rssCache) {
    if (v.expiresAt <= now) rssCache.delete(k);
  }
}, 2 * 60 * 1000).unref?.();

const ALLOWED_DOMAINS = [
  'feeds.bbci.co.uk', 'www.theguardian.com', 'feeds.npr.org', 'news.google.com',
  'www.aljazeera.com', 'rss.cnn.com', 'hnrss.org', 'feeds.arstechnica.com',
  'www.theverge.com', 'www.cnbc.com', 'feeds.marketwatch.com', 'www.defenseone.com',
  'breakingdefense.com', 'www.bellingcat.com', 'techcrunch.com', 'huggingface.co',
  'www.technologyreview.com', 'rss.arxiv.org', 'export.arxiv.org',
  'www.federalreserve.gov', 'www.sec.gov', 'www.whitehouse.gov', 'www.state.gov',
  'www.defense.gov', 'home.treasury.gov', 'www.justice.gov', 'tools.cdc.gov',
  'www.fema.gov', 'www.dhs.gov', 'www.thedrive.com', 'krebsonsecurity.com',
  'finance.yahoo.com', 'thediplomat.com', 'venturebeat.com', 'foreignpolicy.com',
  'www.ft.com', 'openai.com', 'www.reutersagency.com', 'feeds.reuters.com',
  'rsshub.app', 'asia.nikkei.com', 'www.cfr.org', 'www.csis.org',
  'www.politico.com', 'www.brookings.edu', 'layoffs.fyi', 'www.defensenews.com',
  'www.foreignaffairs.com', 'www.atlanticcouncil.org',
  'www.zdnet.com', 'www.techmeme.com', 'www.darkreading.com', 'www.schneier.com',
  'rss.politico.com', 'www.anandtech.com', 'www.tomshardware.com', 'www.semianalysis.com',
  'feed.infoq.com', 'thenewstack.io', 'devops.com', 'dev.to', 'lobste.rs',
  'changelog.com', 'seekingalpha.com', 'news.crunchbase.com', 'www.saastr.com',
  'feeds.feedburner.com', 'www.producthunt.com', 'www.axios.com', 'github.blog',
  'githubnext.com', 'mshibanami.github.io', 'www.engadget.com', 'news.mit.edu',
  'dev.events', 'www.ycombinator.com', 'a16z.com', 'review.firstround.com',
  'www.sequoiacap.com', 'www.nfx.com', 'www.aaronsw.com', 'bothsidesofthetable.com',
  'www.lennysnewsletter.com', 'stratechery.com', 'www.eu-startups.com', 'tech.eu',
  'sifted.eu', 'www.techinasia.com', 'kr-asia.com', 'techcabal.com',
  'disrupt-africa.com', 'lavca.org', 'contxto.com', 'inc42.com', 'yourstory.com',
  'pitchbook.com', 'www.cbinsights.com', 'www.techstars.com',
  'english.alarabiya.net', 'www.arabnews.com', 'www.timesofisrael.com',
  'www.haaretz.com', 'www.scmp.com', 'kyivindependent.com', 'www.themoscowtimes.com',
  'feeds.24.com', 'feeds.capi24.com', 'www.france24.com', 'www.euronews.com',
  'www.lemonde.fr', 'rss.dw.com', 'www.africanews.com', 'www.lasillavacia.com',
  'www.channelnewsasia.com', 'www.thehindu.com', 'news.un.org', 'www.iaea.org',
  'www.who.int', 'www.cisa.gov', 'www.crisisgroup.org',
  'rusi.org', 'warontherocks.com', 'www.aei.org', 'responsiblestatecraft.org',
  'www.fpri.org', 'jamestown.org', 'www.chathamhouse.org', 'ecfr.eu',
  'www.gmfus.org', 'www.wilsoncenter.org', 'www.lowyinstitute.org', 'www.mei.edu',
  'www.stimson.org', 'www.cnas.org', 'carnegieendowment.org', 'www.rand.org',
  'fas.org', 'www.armscontrol.org', 'www.nti.org', 'thebulletin.org',
  'www.iss.europa.eu', 'www.fao.org', 'worldbank.org', 'www.imf.org',
  'news.ycombinator.com', 'seekingalpha.com', 'www.coindesk.com', 'cointelegraph.com',
];

interface RssProxyResult {
  data: string;
  contentType: string;
  status: number;
}

interface RssProxyError {
  error: string;
  details?: string;
  url?: string;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRssFeed(params: { url: string }): Promise<RssProxyResult | RssProxyError> {
  const { url: feedUrl } = params;

  if (!feedUrl) {
    throw new Error('Missing url parameter');
  }

  const parsedUrl = new URL(feedUrl);

  if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
    throw new Error('Domain not allowed');
  }

  // Return cached response if available
  const cached = rssCache.get(feedUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  // Coalesce concurrent requests for the same URL
  const existing = inflight.get(feedUrl);
  if (existing) return existing;

  const promise = fetchRssFeedRaw(feedUrl);
  inflight.set(feedUrl, promise);
  try {
    const result = await promise;
    // Only cache successful responses
    if ('data' in result) {
      rssCache.set(feedUrl, { result, expiresAt: Date.now() + RSS_CACHE_TTL });
    }
    return result;
  } finally {
    inflight.delete(feedUrl);
  }
}

async function fetchRssFeedRaw(feedUrl: string): Promise<RssProxyResult | RssProxyError> {
  const isGoogleNews = feedUrl.includes('news.google.com');
  const timeout = isGoogleNews ? 20000 : 12000;

  try {
    const response = await fetchWithTimeout(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'manual',
    }, timeout);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        const redirectUrl = new URL(location, feedUrl);
        if (!ALLOWED_DOMAINS.includes(redirectUrl.hostname)) {
          throw new Error('Redirect to disallowed domain');
        }
        const redirectResponse = await fetchWithTimeout(redirectUrl.href, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        }, timeout);
        const data = await redirectResponse.text();
        return { data, contentType: 'application/xml', status: redirectResponse.status };
      }
    }

    const data = await response.text();
    return { data, contentType: 'application/xml', status: response.status };
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    console.error('RSS proxy error:', feedUrl, error.message);
    return {
      error: isTimeout ? 'Feed timeout' : 'Failed to fetch feed',
      details: error.message,
      url: feedUrl,
    };
  }
}
