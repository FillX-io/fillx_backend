/**
 * NASA FIRMS Satellite Fire Detection Service
 * Fetches fire data from NASA FIRMS for monitored conflict regions.
 * In-memory cache with 10min TTL.
 */

const FIRMS_CACHE_TTL_MS = 600 * 1000; // 10 min
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const SOURCE = 'VIIRS_SNPP_NRT';

const MONITORED_REGIONS: Record<string, { bbox: string }> = {
  'Ukraine':      { bbox: '22,44,40,53' },
  'Russia':       { bbox: '20,50,180,82' },
  'Iran':         { bbox: '44,25,63,40' },
  'Israel/Gaza':  { bbox: '34,29,36,34' },
  'Syria':        { bbox: '35,32,42,37' },
  'Taiwan':       { bbox: '119,21,123,26' },
  'North Korea':  { bbox: '124,37,131,43' },
  'Saudi Arabia': { bbox: '34,16,56,32' },
  'Turkey':       { bbox: '26,36,45,42' },
};

interface FirePoint {
  lat: number;
  lon: number;
  brightness: number;
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: number;
  bright_t31: number;
  frp: number;
  daynight: string;
}

interface FirmsResult {
  regions: Record<string, FirePoint[]>;
  totalCount: number;
  source: string;
  days: number;
  timestamp: string;
  skipped?: boolean;
  reason?: string;
}

const cache = new Map<string, { data: FirmsResult; expires: number }>();

function parseConfidence(c: string): number {
  if (c === 'h') return 95;
  if (c === 'n') return 50;
  if (c === 'l') return 20;
  return parseInt(c) || 0;
}

function parseCSV(csv: string): FirePoint[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const results: FirePoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim());
    if (vals.length < headers.length) continue;

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx]; });

    results.push({
      lat: parseFloat(row.latitude),
      lon: parseFloat(row.longitude),
      brightness: parseFloat(row.bright_ti4) || 0,
      scan: parseFloat(row.scan) || 0,
      track: parseFloat(row.track) || 0,
      acq_date: row.acq_date || '',
      acq_time: row.acq_time || '',
      satellite: row.satellite || '',
      confidence: parseConfidence(row.confidence),
      bright_t31: parseFloat(row.bright_ti5) || 0,
      frp: parseFloat(row.frp) || 0,
      daynight: row.daynight || '',
    });
  }

  return results;
}

export async function getFirmsFires(params?: {
  region?: string;
  days?: number;
}): Promise<FirmsResult> {
  const FIRMS_API_KEY = process.env.NASA_FIRMS_API_KEY || process.env.FIRMS_API_KEY || '';
  if (!FIRMS_API_KEY) {
    return {
      regions: {},
      totalCount: 0,
      skipped: true,
      reason: 'NASA_FIRMS_API_KEY not configured',
      source: SOURCE,
      days: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const regionName = params?.region;
  const days = Math.min(params?.days || 1, 5);

  const regions = regionName
    ? { [regionName]: MONITORED_REGIONS[regionName] }
    : MONITORED_REGIONS;

  if (regionName && !MONITORED_REGIONS[regionName]) {
    throw new Error(`Unknown region: ${regionName}`);
  }

  const cacheKey = `firms:${regionName || 'all'}:${days}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }

  try {
    const allFires: Record<string, FirePoint[]> = {};
    let totalCount = 0;
    const entries = Object.entries(regions);
    const results = await Promise.allSettled(
      entries.map(async ([name, { bbox }]) => {
        const url = `${FIRMS_BASE}/${FIRMS_API_KEY}/${SOURCE}/${bbox}/${days}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'text/csv' },
        });
        if (!res.ok) throw new Error(`FIRMS ${res.status} for ${name}`);
        const csv = await res.text();
        return { name, fires: parseCSV(csv) };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { name, fires } = result.value;
        allFires[name] = fires;
        totalCount += fires.length;
      } else {
        console.error('[FIRMS]', result.reason?.message);
      }
    }

    const resultData: FirmsResult = {
      regions: allFires,
      totalCount,
      source: SOURCE,
      days,
      timestamp: new Date().toISOString(),
    };

    cache.set(cacheKey, { data: resultData, expires: Date.now() + FIRMS_CACHE_TTL_MS });
    return resultData;
  } catch (err: any) {
    console.error('[FIRMS] Error:', err);
    throw new Error('Failed to fetch fire data');
  }
}
