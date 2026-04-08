// UCDP GED (Georeferenced Event Dataset) proxy
// Returns individual conflict events with coordinates

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const UCDP_PAGE_SIZE = 1000;
const MAX_PAGES = 12;
const TRAILING_WINDOW_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

let cache: { data: unknown; expires: number } | null = null;

const VIOLENCE_TYPE_MAP: Record<number, string> = {
  1: 'state-based',
  2: 'non-state',
  3: 'one-sided',
};

interface UcdpGedEvent {
  id: string;
  date_start: string;
  date_end: string;
  latitude: number;
  longitude: number;
  country: string;
  side_a: string;
  side_b: string;
  deaths_best: number;
  deaths_low: number;
  deaths_high: number;
  type_of_violence: string;
  source_original: string;
}

interface UcdpEventsResult {
  success: boolean;
  count: number;
  data: UcdpGedEvent[];
  version: string;
  cached_at: string;
}

function parseDateMs(value: unknown): number {
  if (!value) return NaN;
  return Date.parse(String(value));
}

function getMaxDateMs(events: Record<string, unknown>[]): number {
  let maxMs = NaN;
  for (const event of events) {
    const ms = parseDateMs(event?.date_start);
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(maxMs) || ms > maxMs) {
      maxMs = ms;
    }
  }
  return maxMs;
}

function buildVersionCandidates(): string[] {
  const year = new Date().getFullYear() - 2000;
  return Array.from(new Set([
    `${year}.1`,
    `${year - 1}.1`,
    '25.1',
    '24.1',
  ]));
}

async function fetchGedPage(version: string, page: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://ucdpapi.pcr.uu.se/api/gedevents/${version}?pagesize=${UCDP_PAGE_SIZE}&page=${page}`,
      { headers: { Accept: 'application/json' }, signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`UCDP GED API error (${version}, page ${page}): ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverGedVersion(): Promise<{ version: string; page0: Record<string, unknown> }> {
  const candidates = buildVersionCandidates();
  for (const version of candidates) {
    try {
      const page0 = await fetchGedPage(version, 0);
      if (Array.isArray(page0?.Result)) {
        return { version, page0 };
      }
    } catch {
      // Try the next version candidate.
    }
  }
  throw new Error('Unable to fetch UCDP GED metadata from known API versions');
}

export async function fetchUcdpEvents(): Promise<UcdpEventsResult> {
  const now = Date.now();

  if (cache && now < cache.expires) {
    return cache.data as UcdpEventsResult;
  }

  const { version, page0 } = await discoverGedVersion();
  const totalPages = Math.max(1, Number(page0?.TotalPages) || 1);
  const newestPage = totalPages - 1;

  let allEvents: Record<string, unknown>[] = [];
  let latestDatasetMs = NaN;

  for (let offset = 0; offset < MAX_PAGES && (newestPage - offset) >= 0; offset++) {
    const page = newestPage - offset;
    const rawData = page === 0 ? page0 : await fetchGedPage(version, page);
    const events = Array.isArray(rawData?.Result) ? rawData.Result as Record<string, unknown>[] : [];
    allEvents = allEvents.concat(events);

    const pageMaxMs = getMaxDateMs(events);
    if (!Number.isFinite(latestDatasetMs) && Number.isFinite(pageMaxMs)) {
      latestDatasetMs = pageMaxMs;
    }

    // Pages are ordered oldest->newest; once we are fully outside trailing window, stop.
    if (Number.isFinite(latestDatasetMs) && Number.isFinite(pageMaxMs)) {
      const cutoffMs = latestDatasetMs - TRAILING_WINDOW_MS;
      if (pageMaxMs < cutoffMs) {
        break;
      }
    }
  }

  const sanitized: UcdpGedEvent[] = allEvents
    .filter((event) => {
      if (!Number.isFinite(latestDatasetMs)) return true;
      const eventMs = parseDateMs(event?.date_start);
      if (!Number.isFinite(eventMs)) return false;
      return eventMs >= (latestDatasetMs - TRAILING_WINDOW_MS);
    })
    .map((e) => ({
      id: String(e.id || ''),
      date_start: (e.date_start as string) || '',
      date_end: (e.date_end as string) || '',
      latitude: Number(e.latitude) || 0,
      longitude: Number(e.longitude) || 0,
      country: (e.country as string) || '',
      side_a: ((e.side_a as string) || '').substring(0, 200),
      side_b: ((e.side_b as string) || '').substring(0, 200),
      deaths_best: Number(e.best) || 0,
      deaths_low: Number(e.low) || 0,
      deaths_high: Number(e.high) || 0,
      type_of_violence: VIOLENCE_TYPE_MAP[e.type_of_violence as number] || 'state-based',
      source_original: ((e.source_original as string) || '').substring(0, 300),
    }))
    .sort((a, b) => {
      const bMs = parseDateMs(b.date_start);
      const aMs = parseDateMs(a.date_start);
      return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
    });

  const result: UcdpEventsResult = {
    success: true,
    count: sanitized.length,
    data: sanitized,
    version,
    cached_at: new Date().toISOString(),
  };

  cache = { data: result, expires: now + CACHE_TTL_MS };

  return result;
}
