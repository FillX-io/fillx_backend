// HDX HAPI (Humanitarian API) proxy
// Returns aggregated conflict event counts per country
// Source: ACLED data aggregated monthly by HDX

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cache: { data: unknown; expires: number } | null = null;

interface HapiCountryEntry {
  iso3: string;
  locationName: string;
  month: string;
  eventsTotal: number;
  eventsPoliticalViolence: number;
  eventsCivilianTargeting: number;
  eventsDemonstrations: number;
  fatalitiesTotalPoliticalViolence: number;
  fatalitiesTotalCivilianTargeting: number;
}

interface HapiResult {
  success: boolean;
  count: number;
  countries: HapiCountryEntry[];
  cached_at: string;
}

export async function fetchHapiConflictEvents(): Promise<HapiResult> {
  const now = Date.now();

  if (cache && now < cache.expires) {
    return cache.data as HapiResult;
  }

  const appId = btoa('worldmonitor:monitor@worldmonitor.app');
  const response = await fetch(
    `https://hapi.humdata.org/api/v2/coordination-context/conflict-events?output_format=json&limit=1000&offset=0&app_identifier=${appId}`,
    { headers: { Accept: 'application/json' } },
  );

  if (!response.ok) {
    throw new Error(`HAPI API error: ${response.status}`);
  }

  const rawData = await response.json();
  const records: Record<string, unknown>[] = rawData.data || [];

  // Each record is (country, event_type, month) - aggregate across event types per country
  // Keep only the most recent month per country
  const byCountry: Record<string, HapiCountryEntry> = {};
  for (const r of records) {
    const iso3 = (r.location_code as string) || '';
    if (!iso3) continue;

    const month = (r.reference_period_start as string) || '';
    const eventType = ((r.event_type as string) || '').toLowerCase();
    const events = (r.events as number) || 0;
    const fatalities = (r.fatalities as number) || 0;

    if (!byCountry[iso3]) {
      byCountry[iso3] = {
        iso3,
        locationName: (r.location_name as string) || '',
        month,
        eventsTotal: 0,
        eventsPoliticalViolence: 0,
        eventsCivilianTargeting: 0,
        eventsDemonstrations: 0,
        fatalitiesTotalPoliticalViolence: 0,
        fatalitiesTotalCivilianTargeting: 0,
      };
    }

    const c = byCountry[iso3];
    if (month > c.month) {
      // Newer month - reset
      c.month = month;
      c.eventsTotal = 0;
      c.eventsPoliticalViolence = 0;
      c.eventsCivilianTargeting = 0;
      c.eventsDemonstrations = 0;
      c.fatalitiesTotalPoliticalViolence = 0;
      c.fatalitiesTotalCivilianTargeting = 0;
    }
    if (month === c.month) {
      c.eventsTotal += events;
      if (eventType.includes('political_violence')) {
        c.eventsPoliticalViolence += events;
        c.fatalitiesTotalPoliticalViolence += fatalities;
      }
      if (eventType.includes('civilian_targeting')) {
        c.eventsCivilianTargeting += events;
        c.fatalitiesTotalCivilianTargeting += fatalities;
      }
      if (eventType.includes('demonstration')) {
        c.eventsDemonstrations += events;
      }
    }
  }

  const result: HapiResult = {
    success: true,
    count: Object.keys(byCountry).length,
    countries: Object.values(byCountry),
    cached_at: new Date().toISOString(),
  };

  cache = { data: result, expires: now + CACHE_TTL_MS };

  return result;
}
