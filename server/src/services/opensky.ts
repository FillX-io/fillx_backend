/**
 * OpenSky Network API Proxy Service
 * Proxies requests to OpenSky to avoid CORS issues.
 */

interface OpenskyParams {
  lamin?: string;
  lomin?: string;
  lamax?: string;
  lomax?: string;
}

interface OpenskyResult {
  time?: number;
  states?: any[] | null;
  error?: string;
}

export async function getOpenskyStates(params?: OpenskyParams): Promise<OpenskyResult> {
  const queryParams = new URLSearchParams();
  if (params) {
    (['lamin', 'lomin', 'lamax', 'lomax'] as const).forEach((key) => {
      const val = params[key];
      if (val) queryParams.set(key, val);
    });
  }

  const openskyUrl = `https://opensky-network.org/api/states/all${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

  try {
    const response = await fetch(openskyUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
      },
    });

    if (response.status === 429) {
      return { error: 'Rate limited', time: Date.now(), states: null };
    }

    if (!response.ok) {
      const text = await response.text();
      return {
        error: `OpenSky HTTP ${response.status}: ${text.substring(0, 200)}`,
        time: Date.now(),
        states: null,
      };
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    return {
      error: `Fetch failed: ${error.name} - ${error.message}`,
      time: Date.now(),
      states: null,
    };
  }
}
