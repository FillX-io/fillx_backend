// ACLED Conflict Events API proxy - battles, explosions, violence against civilians
// Separate from protest proxy to avoid mixing data flows

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let cache: { data: unknown; expires: number } | null = null;

interface AcledConflictEvent {
  event_id_cnty: string;
  event_date: string;
  event_type: string;
  sub_event_type: string;
  actor1: string;
  actor2: string;
  country: string;
  admin1: string;
  location: string;
  latitude: string;
  longitude: string;
  fatalities: string;
  notes?: string;
  source: string;
  tags: string;
}

interface AcledConflictResult {
  success: boolean;
  count: number;
  data: AcledConflictEvent[];
  cached_at: string;
}

export async function fetchAcledConflict(): Promise<AcledConflictResult> {
  const now = Date.now();

  if (cache && now < cache.expires) {
    return cache.data as AcledConflictResult;
  }

  const token = process.env.ACLED_ACCESS_TOKEN;
  if (!token) {
    return {
      success: false,
      count: 0,
      data: [],
      cached_at: new Date().toISOString(),
    } as unknown as AcledConflictResult;
  }

  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const params = new URLSearchParams({
    event_type: 'Battles|Explosions/Remote violence|Violence against civilians',
    event_date: `${startDate}|${endDate}`,
    event_date_where: 'BETWEEN',
    limit: '500',
    _format: 'json',
  });

  const response = await fetch(`https://acleddata.com/api/acled/read?${params}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ACLED API error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const rawData = await response.json();
  const events = Array.isArray(rawData?.data) ? rawData.data : [];
  const sanitizedEvents: AcledConflictEvent[] = events.map((e: Record<string, unknown>) => ({
    event_id_cnty: e.event_id_cnty,
    event_date: e.event_date,
    event_type: e.event_type,
    sub_event_type: e.sub_event_type,
    actor1: e.actor1,
    actor2: e.actor2,
    country: e.country,
    admin1: e.admin1,
    location: e.location,
    latitude: e.latitude,
    longitude: e.longitude,
    fatalities: e.fatalities,
    notes: typeof e.notes === 'string' ? e.notes.substring(0, 500) : undefined,
    source: e.source,
    tags: e.tags,
  })) as AcledConflictEvent[];

  const result: AcledConflictResult = {
    success: true,
    count: sanitizedEvents.length,
    data: sanitizedEvents,
    cached_at: new Date().toISOString(),
  };

  cache = { data: result, expires: now + CACHE_TTL_MS };

  return result;
}
