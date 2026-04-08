// Wingbits API proxy service
// Keeps API key server-side via process.env.WINGBITS_API_KEY

interface FlightParams {
  la?: string;
  lat?: string;
  lo?: string;
  lon?: string;
  w?: string;
  width?: string;
  h?: string;
  height?: string;
  unit?: string;
}

interface BatchArea {
  id?: string;
  alias?: string;
  north: number;
  south: number;
  east: number;
  west: number;
}

interface WingbitsArea {
  alias: string;
  by: string;
  la: number;
  lo: number;
  w: number;
  h: number;
  unit: string;
}

function getApiKey(): string | undefined {
  return process.env.WINGBITS_API_KEY;
}

export function getWingbitsHealth(): { configured: boolean; error?: string } {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { configured: false, error: 'Wingbits not configured' };
  }
  return { configured: true };
}

export async function checkWingbitsHealth(): Promise<Record<string, unknown>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: 'Wingbits not configured', configured: false };
  }

  try {
    const response = await fetch('https://customer-api.wingbits.com/health', {
      headers: { 'x-api-key': apiKey },
    });
    const data = await response.json();
    return { ...data, configured: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { error: message, configured: true };
  }
}

export async function fetchFlightDetails(
  icao24: string
): Promise<Record<string, unknown>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Wingbits not configured');
  }

  const id = icao24.toLowerCase();

  const response = await fetch(
    `https://customer-api.wingbits.com/v1/flights/details/${id}`,
    {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Wingbits API error: ${response.status}`);
  }

  return response.json();
}

export async function fetchFlightDetailsBatch(
  icao24s: string[]
): Promise<{
  results: Record<string, unknown>;
  fetched: number;
  requested: number;
}> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Wingbits not configured');
  }

  if (!Array.isArray(icao24s) || icao24s.length === 0) {
    throw new Error('icao24s array required');
  }

  // Limit batch size to avoid overwhelming the API
  const limitedList = icao24s.slice(0, 20).map((id) => id.toLowerCase());
  const results: Record<string, unknown> = {};

  // Fetch all in parallel
  const fetchPromises = limitedList.map(async (icao24) => {
    try {
      const response = await fetch(
        `https://customer-api.wingbits.com/v1/flights/details/${icao24}`,
        {
          headers: {
            'x-api-key': apiKey!,
            Accept: 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return { icao24, data };
      }
    } catch {
      // Skip failed lookups
    }
    return null;
  });

  const fetchResults = await Promise.all(fetchPromises);

  for (const result of fetchResults) {
    if (result) {
      results[result.icao24] = result.data;
    }
  }

  return {
    results,
    fetched: Object.keys(results).length,
    requested: limitedList.length,
  };
}

export async function fetchFlights(
  params: FlightParams
): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Wingbits not configured');
  }

  const la = params.la || params.lat;
  const lo = params.lo || params.lon;
  const w = params.w || params.width || '500';
  const h = params.h || params.height || '500';
  const unit = params.unit || 'nm';

  if (!la || !lo) {
    throw new Error('lat (la) and lon (lo) required');
  }

  const wingbitsUrl = `https://customer-api.wingbits.com/v1/flights?by=box&la=${la}&lo=${lo}&w=${w}&h=${h}&unit=${unit}`;
  console.log('[Wingbits] Fetching flights:', wingbitsUrl);

  const response = await fetch(wingbitsUrl, {
    headers: {
      'x-api-key': apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Wingbits] API error:', response.status, errorText);
    throw new Error(`Wingbits API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log(
    '[Wingbits] Got',
    Array.isArray(data) ? data.length : 0,
    'flights'
  );

  return data;
}

export async function fetchFlightsBatch(
  areas: BatchArea[]
): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Wingbits not configured');
  }

  if (!Array.isArray(areas) || areas.length === 0) {
    throw new Error('areas array required');
  }

  // Wingbits batch endpoint format
  const wingbitsAreas: WingbitsArea[] = areas.map((area) => ({
    alias: area.id || area.alias || '',
    by: 'box',
    la: (area.north + area.south) / 2,
    lo: (area.east + area.west) / 2,
    w: Math.abs(area.east - area.west) * 60, // degrees to nautical miles (approx)
    h: Math.abs(area.north - area.south) * 60,
    unit: 'nm',
  }));

  const response = await fetch(
    'https://customer-api.wingbits.com/v1/flights',
    {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(wingbitsAreas),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wingbits API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('[Wingbits] Batch got', data.length, 'area results');

  return data;
}
