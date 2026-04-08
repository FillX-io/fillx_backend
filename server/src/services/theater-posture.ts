// Theater Posture API - Aggregates military aircraft by theater
// TTL: 5 minutes (matches OpenSky refresh rate)

const CACHE_TTL_MS = 300 * 1000; // 5 minutes
const STALE_CACHE_TTL_MS = 86400 * 1000; // 24 hours

let cache: { data: unknown; expires: number } | null = null;
let staleCache: { data: unknown; expires: number } | null = null;

// Theater definitions (matches client-side POSTURE_THEATERS)
const POSTURE_THEATERS = [
  {
    id: 'iran-theater',
    name: 'Iran Theater',
    shortName: 'IRAN',
    targetNation: 'Iran' as string | null,
    bounds: { north: 42, south: 20, east: 65, west: 30 },
    thresholds: { elevated: 8, critical: 20 },
    strikeIndicators: { minTankers: 2, minAwacs: 1, minFighters: 5 },
  },
  {
    id: 'taiwan-theater',
    name: 'Taiwan Strait',
    shortName: 'TAIWAN',
    targetNation: 'Taiwan' as string | null,
    bounds: { north: 30, south: 18, east: 130, west: 115 },
    thresholds: { elevated: 6, critical: 15 },
    strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 4 },
  },
  {
    id: 'baltic-theater',
    name: 'Baltic Theater',
    shortName: 'BALTIC',
    targetNation: null as string | null,
    bounds: { north: 65, south: 52, east: 32, west: 10 },
    thresholds: { elevated: 5, critical: 12 },
    strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
    id: 'blacksea-theater',
    name: 'Black Sea',
    shortName: 'BLACK SEA',
    targetNation: null as string | null,
    bounds: { north: 48, south: 40, east: 42, west: 26 },
    thresholds: { elevated: 4, critical: 10 },
    strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
    id: 'korea-theater',
    name: 'Korean Peninsula',
    shortName: 'KOREA',
    targetNation: 'North Korea' as string | null,
    bounds: { north: 43, south: 33, east: 132, west: 124 },
    thresholds: { elevated: 5, critical: 12 },
    strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
    id: 'south-china-sea',
    name: 'South China Sea',
    shortName: 'SCS',
    targetNation: null as string | null,
    bounds: { north: 25, south: 5, east: 121, west: 105 },
    thresholds: { elevated: 6, critical: 15 },
    strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 4 },
  },
  {
    id: 'east-med-theater',
    name: 'Eastern Mediterranean',
    shortName: 'E.MED',
    targetNation: null as string | null,
    bounds: { north: 37, south: 33, east: 37, west: 25 },
    thresholds: { elevated: 4, critical: 10 },
    strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
    id: 'israel-gaza-theater',
    name: 'Israel/Gaza',
    shortName: 'GAZA',
    targetNation: 'Gaza' as string | null,
    bounds: { north: 33, south: 29, east: 36, west: 33 },
    thresholds: { elevated: 3, critical: 8 },
    strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
    id: 'yemen-redsea-theater',
    name: 'Yemen/Red Sea',
    shortName: 'RED SEA',
    targetNation: 'Yemen' as string | null,
    bounds: { north: 22, south: 11, east: 54, west: 32 },
    thresholds: { elevated: 4, critical: 10 },
    strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
];

// Military callsign prefixes for identification
const MILITARY_PREFIXES = [
  'RCH', 'REACH', 'MOOSE', 'EVAC', 'DUSTOFF', 'PEDRO',
  'DUKE', 'HAVOC', 'KNIFE', 'WARHAWK', 'VIPER', 'RAGE', 'FURY',
  'SHELL', 'TEXACO', 'ARCO', 'ESSO', 'PETRO',
  'SENTRY', 'AWACS', 'MAGIC', 'DISCO', 'DARKSTAR',
  'COBRA', 'PYTHON', 'RAPTOR', 'EAGLE', 'HAWK', 'TALON',
  'BOXER', 'OMNI', 'TOPCAT', 'SKULL', 'REAPER', 'HUNTER',
  'ARMY', 'NAVY', 'USAF', 'USMC', 'USCG',
  'AE', 'CNV', 'PAT', 'SAM', 'EXEC',
  'OPS', 'CTF', 'TF',
  'NATO', 'GAF', 'RRF', 'RAF', 'FAF', 'IAF', 'RNLAF', 'BAF', 'DAF', 'HAF', 'PAF',
  'SWORD', 'LANCE', 'ARROW', 'SPARTAN',
  'RSAF', 'EMIRI', 'UAEAF', 'KAF', 'QAF', 'BAHAF', 'OMAAF',
  'IRIAF', 'IRG', 'IRGC',
  'TAF', 'TUAF',
  'RSD', 'RF', 'RFF', 'VKS',
  'CHN', 'PLAAF', 'PLA',
];

const AIRLINE_CODES = new Set([
  'SVA', 'QTR', 'THY', 'UAE', 'ETD', 'GFA', 'MEA', 'RJA', 'KAC', 'ELY',
  'IAW', 'IRA', 'MSR', 'SYR', 'PGT', 'AXB', 'FDB', 'KNE', 'FAD', 'ADY', 'OMA',
  'ABQ', 'ABY', 'NIA', 'FJA', 'SWR', 'HZA', 'OMS', 'EGF', 'NOS', 'SXD',
  'BAW', 'AFR', 'DLH', 'KLM', 'AUA', 'SAS', 'FIN', 'LOT', 'AZA', 'TAP', 'IBE',
  'VLG', 'RYR', 'EZY', 'WZZ', 'NOZ', 'BEL', 'AEE', 'ROT',
  'AIC', 'CPA', 'SIA', 'MAS', 'THA', 'VNM', 'JAL', 'ANA', 'KAL', 'AAR', 'EVA',
  'CAL', 'CCA', 'CES', 'CSN', 'HDA', 'CHH', 'CXA', 'GIA', 'PAL', 'SLK',
  'AAL', 'DAL', 'UAL', 'SWA', 'JBU', 'FFT', 'ASA', 'NKS', 'WJA', 'ACA',
  'FDX', 'UPS', 'GTI', 'ABW', 'CLX', 'MPH',
  'AIR', 'SKY', 'JET',
]);

interface MilitaryFlight {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number;
  heading: number;
  speed: number;
  aircraftType: string;
  operator: string;
  militaryHex?: boolean;
  source?: string;
}

interface TheaterPostureSummary {
  theaterId: string;
  theaterName: string;
  shortName: string;
  targetNation: string | null;
  fighters: number;
  tankers: number;
  awacs: number;
  reconnaissance: number;
  transport: number;
  bombers: number;
  drones: number;
  unknown: number;
  totalAircraft: number;
  destroyers: number;
  frigates: number;
  carriers: number;
  submarines: number;
  patrol: number;
  auxiliaryVessels: number;
  totalVessels: number;
  byOperator: Record<string, number>;
  postureLevel: string;
  strikeCapable: boolean;
  trend: string;
  changePercent: number;
  summary: string;
  headline: string;
  centerLat: number;
  centerLon: number;
  bounds: { north: number; south: number; east: number; west: number };
}

interface TheaterPostureResult {
  postures: TheaterPostureSummary[];
  totalFlights: number;
  timestamp: string;
  cached: boolean;
  source: string;
  stale?: boolean;
  error?: string;
}

function detectAircraftType(callsign: string | undefined): string {
  if (!callsign) return 'unknown';
  const cs = callsign.toUpperCase().trim();

  if (/^(SHELL|TEXACO|ARCO|ESSO|PETRO)/.test(cs)) return 'tanker';
  if (/^(KC|STRAT)/.test(cs)) return 'tanker';
  if (/^(SENTRY|AWACS|MAGIC|DISCO|DARKSTAR)/.test(cs)) return 'awacs';
  if (/^(E3|E8|E6)/.test(cs)) return 'awacs';
  if (/^(RCH|REACH|MOOSE|EVAC|DUSTOFF)/.test(cs)) return 'transport';
  if (/^(C17|C5|C130|C40)/.test(cs)) return 'transport';
  if (/^(HOMER|OLIVE|JAKE|PSEUDO|GORDO)/.test(cs)) return 'reconnaissance';
  if (/^(RC|U2|SR)/.test(cs)) return 'reconnaissance';
  if (/^(RQ|MQ|REAPER|PREDATOR|GLOBAL)/.test(cs)) return 'drone';
  if (/^(DEATH|BONE|DOOM)/.test(cs)) return 'bomber';
  if (/^(B52|B1|B2)/.test(cs)) return 'bomber';

  return 'unknown';
}

function isMilitaryCallsign(callsign: string | undefined): boolean {
  if (!callsign) return false;
  const cs = callsign.toUpperCase().trim();

  for (const prefix of MILITARY_PREFIXES) {
    if (cs.startsWith(prefix)) return true;
  }

  if (/^[A-Z]{4,}\d{1,3}$/.test(cs)) return true;

  if (/^[A-Z]{3}\d{1,2}$/.test(cs)) {
    const prefix = cs.slice(0, 3);
    if (!AIRLINE_CODES.has(prefix)) return true;
  }

  return false;
}

async function fetchMilitaryFlights(): Promise<MilitaryFlight[]> {
  const isSidecar = (process.env.LOCAL_API_MODE || '').includes('sidecar');
  const baseUrl = isSidecar
    ? 'https://opensky-network.org/api/states/all'
    : (process.env.WS_RELAY_URL ? process.env.WS_RELAY_URL + '/opensky' : null);

  if (!baseUrl) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(baseUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 GlobalIntel/1.0',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenSky API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.states) return [];

    const flights: MilitaryFlight[] = [];
    for (const state of data.states) {
      const [icao24, callsign, , , , lon, lat, altitude, onGround, velocity, heading] = state;

      if (lat == null || lon == null) continue;
      if (onGround) continue;

      const isMilitary = isMilitaryCallsign(callsign);
      if (!isMilitary) continue;

      flights.push({
        id: icao24,
        callsign: callsign?.trim() || '',
        lat,
        lon,
        altitude: altitude || 0,
        heading: heading || 0,
        speed: velocity || 0,
        aircraftType: detectAircraftType(callsign),
        operator: 'unknown',
      });
    }

    return flights;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('OpenSky API timeout - try again');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchMilitaryFlightsFromWingbits(): Promise<MilitaryFlight[] | null> {
  const apiKey = process.env.WINGBITS_API_KEY;
  if (!apiKey) return null;

  const areas = POSTURE_THEATERS.map(theater => ({
    alias: theater.id,
    by: 'box',
    la: (theater.bounds.north + theater.bounds.south) / 2,
    lo: (theater.bounds.east + theater.bounds.west) / 2,
    w: Math.abs(theater.bounds.east - theater.bounds.west) * 60,
    h: Math.abs(theater.bounds.north - theater.bounds.south) * 60,
    unit: 'nm',
  }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://customer-api.wingbits.com/v1/flights', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(areas),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = await response.json();

    const flights: MilitaryFlight[] = [];
    const seenIds = new Set<string>();

    for (const areaResult of data) {
      const areaFlights = areaResult.flights || areaResult.data || areaResult || [];
      const flightList = Array.isArray(areaFlights) ? areaFlights : [];

      for (const f of flightList) {
        const icao24 = f.h || f.icao24 || f.id;
        if (!icao24) continue;
        if (seenIds.has(icao24)) continue;
        seenIds.add(icao24);

        const callsign = f.f || f.callsign || f.flight || '';
        const isMilitary = isMilitaryCallsign(callsign);
        if (!isMilitary) continue;

        flights.push({
          id: icao24,
          callsign: callsign.trim(),
          lat: f.la || f.latitude || f.lat,
          lon: f.lo || f.longitude || f.lon || f.lng,
          altitude: f.ab || f.altitude || f.alt || 0,
          heading: f.th || f.heading || f.track || 0,
          speed: f.gs || f.groundSpeed || f.speed || f.velocity || 0,
          aircraftType: detectAircraftType(callsign),
          operator: f.operator || 'unknown',
          source: 'wingbits',
        });
      }
    }

    return flights;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function calculatePostures(flights: MilitaryFlight[]): TheaterPostureSummary[] {
  const summaries: TheaterPostureSummary[] = [];

  for (const theater of POSTURE_THEATERS) {
    const theaterFlights = flights.filter(f =>
      f.lat >= theater.bounds.south &&
      f.lat <= theater.bounds.north &&
      f.lon >= theater.bounds.west &&
      f.lon <= theater.bounds.east,
    );

    const byType = {
      fighters: theaterFlights.filter(f => f.aircraftType === 'fighter').length,
      tankers: theaterFlights.filter(f => f.aircraftType === 'tanker').length,
      awacs: theaterFlights.filter(f => f.aircraftType === 'awacs').length,
      reconnaissance: theaterFlights.filter(f => f.aircraftType === 'reconnaissance').length,
      transport: theaterFlights.filter(f => f.aircraftType === 'transport').length,
      bombers: theaterFlights.filter(f => f.aircraftType === 'bomber').length,
      drones: theaterFlights.filter(f => f.aircraftType === 'drone').length,
      unknown: theaterFlights.filter(f => f.aircraftType === 'unknown').length,
    };

    const total = Object.values(byType).reduce((a, b) => a + b, 0);

    const postureLevel = total >= theater.thresholds.critical ? 'critical' :
                         total >= theater.thresholds.elevated ? 'elevated' : 'normal';

    const strikeCapable =
      byType.tankers >= theater.strikeIndicators.minTankers &&
      byType.awacs >= theater.strikeIndicators.minAwacs &&
      byType.fighters >= theater.strikeIndicators.minFighters;

    const parts: string[] = [];
    if (byType.fighters > 0) parts.push(`${byType.fighters} fighters`);
    if (byType.tankers > 0) parts.push(`${byType.tankers} tankers`);
    if (byType.awacs > 0) parts.push(`${byType.awacs} AWACS`);
    if (byType.reconnaissance > 0) parts.push(`${byType.reconnaissance} recon`);
    if (byType.bombers > 0) parts.push(`${byType.bombers} bombers`);
    if (byType.transport > 0) parts.push(`${byType.transport} transport`);
    if (byType.drones > 0) parts.push(`${byType.drones} drones`);
    if (byType.unknown > 0) parts.push(`${byType.unknown} other`);
    const summary = parts.join(', ') || 'No military aircraft';

    const headline = postureLevel === 'critical'
      ? `Critical military buildup - ${theater.name}`
      : postureLevel === 'elevated'
      ? `Elevated military activity - ${theater.name}`
      : `Normal activity - ${theater.name}`;

    const byOperator: Record<string, number> = {};
    for (const f of theaterFlights) {
      const op = f.operator || 'unknown';
      byOperator[op] = (byOperator[op] || 0) + 1;
    }

    summaries.push({
      theaterId: theater.id,
      theaterName: theater.name,
      shortName: theater.shortName,
      targetNation: theater.targetNation,
      fighters: byType.fighters,
      tankers: byType.tankers,
      awacs: byType.awacs,
      reconnaissance: byType.reconnaissance,
      transport: byType.transport,
      bombers: byType.bombers,
      drones: byType.drones,
      unknown: byType.unknown,
      totalAircraft: total,
      destroyers: 0,
      frigates: 0,
      carriers: 0,
      submarines: 0,
      patrol: 0,
      auxiliaryVessels: 0,
      totalVessels: 0,
      byOperator,
      postureLevel,
      strikeCapable,
      trend: 'stable',
      changePercent: 0,
      summary,
      headline,
      centerLat: (theater.bounds.north + theater.bounds.south) / 2,
      centerLon: (theater.bounds.east + theater.bounds.west) / 2,
      bounds: theater.bounds,
    });
  }

  return summaries;
}

export async function fetchTheaterPosture(): Promise<TheaterPostureResult> {
  const now = Date.now();

  if (cache && now < cache.expires) {
    return { ...(cache.data as TheaterPostureResult), cached: true };
  }

  try {
    let flights: MilitaryFlight[];
    let source = 'opensky';

    try {
      flights = await fetchMilitaryFlights();
    } catch (openskyError) {
      const wingbitsFlights = await fetchMilitaryFlightsFromWingbits();
      if (wingbitsFlights && wingbitsFlights.length > 0) {
        flights = wingbitsFlights;
        source = 'wingbits';
      } else {
        throw openskyError;
      }
    }

    const postures = calculatePostures(flights);

    const result: TheaterPostureResult = {
      postures,
      totalFlights: flights.length,
      timestamp: new Date().toISOString(),
      cached: false,
      source,
    };

    cache = { data: result, expires: now + CACHE_TTL_MS };
    staleCache = { data: result, expires: now + STALE_CACHE_TTL_MS };

    return result;
  } catch (error) {
    if (staleCache && now < staleCache.expires) {
      return {
        ...(staleCache.data as TheaterPostureResult),
        cached: true,
        stale: true,
        error: 'Using cached data - live feed temporarily unavailable',
      };
    }

    return {
      error: (error as Error).message,
      postures: [],
      totalFlights: 0,
      timestamp: new Date().toISOString(),
      cached: false,
      source: 'none',
    };
  }
}
