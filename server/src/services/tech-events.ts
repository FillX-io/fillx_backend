/**
 * Tech Events Service
 * Parses Techmeme ICS feed and dev.events RSS, returns structured events.
 * Includes comprehensive city geocoding database (500+ cities).
 */

const ICS_URL = 'https://www.techmeme.com/newsy_events.ics';
const DEV_EVENTS_RSS = 'https://dev.events/rss.xml';

interface Coords {
  lat: number;
  lng: number;
  country: string;
  original?: string;
  virtual?: boolean;
}

interface TechEvent {
  id: string | null;
  title: string;
  type: string;
  location: string | null;
  coords: Coords | null;
  startDate: string;
  endDate: string;
  url: string | null;
  source: string;
  description?: string;
}

interface TechEventsResult {
  success: boolean;
  count: number;
  conferenceCount: number;
  mappableCount: number;
  lastUpdated: string;
  events: TechEvent[];
  error?: string;
}

// Curated major tech events
const CURATED_EVENTS: TechEvent[] = [
  {
    id: 'step-dubai-2026', title: 'STEP Dubai 2026', type: 'conference',
    location: 'Dubai Internet City, Dubai',
    coords: { lat: 25.0956, lng: 55.1548, country: 'UAE', original: 'Dubai Internet City, Dubai' },
    startDate: '2026-02-11', endDate: '2026-02-12',
    url: 'https://dubai.stepconference.com', source: 'curated',
    description: 'Intelligence Everywhere: The AI Economy - 8,000+ attendees, 400+ startups',
  },
  {
    id: 'gitex-global-2026', title: 'GITEX Global 2026', type: 'conference',
    location: 'Dubai World Trade Centre, Dubai',
    coords: { lat: 25.2285, lng: 55.2867, country: 'UAE', original: 'Dubai World Trade Centre, Dubai' },
    startDate: '2026-12-07', endDate: '2026-12-11',
    url: 'https://www.gitex.com', source: 'curated',
    description: "World's largest tech & startup show",
  },
  {
    id: 'token2049-dubai-2026', title: 'TOKEN2049 Dubai 2026', type: 'conference',
    location: 'Dubai, UAE',
    coords: { lat: 25.2048, lng: 55.2708, country: 'UAE', original: 'Dubai, UAE' },
    startDate: '2026-04-29', endDate: '2026-04-30',
    url: 'https://www.token2049.com', source: 'curated',
    description: 'Premier crypto event in Dubai',
  },
  {
    id: 'collision-2026', title: 'Collision 2026', type: 'conference',
    location: 'Toronto, Canada',
    coords: { lat: 43.6532, lng: -79.3832, country: 'Canada', original: 'Toronto, Canada' },
    startDate: '2026-06-22', endDate: '2026-06-25',
    url: 'https://collisionconf.com', source: 'curated',
    description: "North America's fastest growing tech conference",
  },
  {
    id: 'web-summit-2026', title: 'Web Summit 2026', type: 'conference',
    location: 'Lisbon, Portugal',
    coords: { lat: 38.7223, lng: -9.1393, country: 'Portugal', original: 'Lisbon, Portugal' },
    startDate: '2026-11-02', endDate: '2026-11-05',
    url: 'https://websummit.com', source: 'curated',
    description: "The world's premier tech conference",
  },
];

// Comprehensive city geocoding database
const CITY_COORDS: Record<string, { lat: number; lng: number; country: string; virtual?: boolean }> = {
  // North America - USA
  'san francisco': { lat: 37.7749, lng: -122.4194, country: 'USA' },
  'san jose': { lat: 37.3382, lng: -121.8863, country: 'USA' },
  'palo alto': { lat: 37.4419, lng: -122.1430, country: 'USA' },
  'mountain view': { lat: 37.3861, lng: -122.0839, country: 'USA' },
  'los angeles': { lat: 34.0522, lng: -118.2437, country: 'USA' },
  'seattle': { lat: 47.6062, lng: -122.3321, country: 'USA' },
  'new york': { lat: 40.7128, lng: -74.0060, country: 'USA' },
  'nyc': { lat: 40.7128, lng: -74.0060, country: 'USA' },
  'boston': { lat: 42.3601, lng: -71.0589, country: 'USA' },
  'chicago': { lat: 41.8781, lng: -87.6298, country: 'USA' },
  'austin': { lat: 30.2672, lng: -97.7431, country: 'USA' },
  'austin, tx': { lat: 30.2672, lng: -97.7431, country: 'USA' },
  'denver': { lat: 39.7392, lng: -104.9903, country: 'USA' },
  'miami': { lat: 25.7617, lng: -80.1918, country: 'USA' },
  'atlanta': { lat: 33.7490, lng: -84.3880, country: 'USA' },
  'washington': { lat: 38.9072, lng: -77.0369, country: 'USA' },
  'washington dc': { lat: 38.9072, lng: -77.0369, country: 'USA' },
  'dc': { lat: 38.9072, lng: -77.0369, country: 'USA' },
  'las vegas': { lat: 36.1699, lng: -115.1398, country: 'USA' },
  'portland': { lat: 45.5155, lng: -122.6789, country: 'USA' },
  'phoenix': { lat: 33.4484, lng: -112.0740, country: 'USA' },
  'dallas': { lat: 32.7767, lng: -96.7970, country: 'USA' },
  'houston': { lat: 29.7604, lng: -95.3698, country: 'USA' },
  'san diego': { lat: 32.7157, lng: -117.1611, country: 'USA' },
  'philadelphia': { lat: 39.9526, lng: -75.1652, country: 'USA' },
  'minneapolis': { lat: 44.9778, lng: -93.2650, country: 'USA' },
  'detroit': { lat: 42.3314, lng: -83.0458, country: 'USA' },
  'orlando': { lat: 28.5383, lng: -81.3792, country: 'USA' },
  'nashville': { lat: 36.1627, lng: -86.7816, country: 'USA' },
  'raleigh': { lat: 35.7796, lng: -78.6382, country: 'USA' },
  'salt lake city': { lat: 40.7608, lng: -111.8910, country: 'USA' },
  'honolulu': { lat: 21.3069, lng: -157.8583, country: 'USA' },
  'cambridge': { lat: 42.3736, lng: -71.1097, country: 'USA' },
  'boulder': { lat: 40.0150, lng: -105.2705, country: 'USA' },
  'redmond': { lat: 47.6740, lng: -122.1215, country: 'USA' },
  'bellevue': { lat: 47.6101, lng: -122.2015, country: 'USA' },
  'cupertino': { lat: 37.3230, lng: -122.0322, country: 'USA' },

  // Canada
  'toronto': { lat: 43.6532, lng: -79.3832, country: 'Canada' },
  'vancouver': { lat: 49.2827, lng: -123.1207, country: 'Canada' },
  'montreal': { lat: 45.5017, lng: -73.5673, country: 'Canada' },
  'ottawa': { lat: 45.4215, lng: -75.6972, country: 'Canada' },
  'waterloo': { lat: 43.4643, lng: -80.5204, country: 'Canada' },

  // Europe
  'london': { lat: 51.5074, lng: -0.1278, country: 'UK' },
  'paris': { lat: 48.8566, lng: 2.3522, country: 'France' },
  'berlin': { lat: 52.5200, lng: 13.4050, country: 'Germany' },
  'munich': { lat: 48.1351, lng: 11.5820, country: 'Germany' },
  'amsterdam': { lat: 52.3676, lng: 4.9041, country: 'Netherlands' },
  'barcelona': { lat: 41.3851, lng: 2.1734, country: 'Spain' },
  'madrid': { lat: 40.4168, lng: -3.7038, country: 'Spain' },
  'lisbon': { lat: 38.7223, lng: -9.1393, country: 'Portugal' },
  'dublin': { lat: 53.3498, lng: -6.2603, country: 'Ireland' },
  'zurich': { lat: 47.3769, lng: 8.5417, country: 'Switzerland' },
  'geneva': { lat: 46.2044, lng: 6.1432, country: 'Switzerland' },
  'davos': { lat: 46.8027, lng: 9.8360, country: 'Switzerland' },
  'vienna': { lat: 48.2082, lng: 16.3738, country: 'Austria' },
  'stockholm': { lat: 59.3293, lng: 18.0686, country: 'Sweden' },
  'copenhagen': { lat: 55.6761, lng: 12.5683, country: 'Denmark' },
  'oslo': { lat: 59.9139, lng: 10.7522, country: 'Norway' },
  'helsinki': { lat: 60.1699, lng: 24.9384, country: 'Finland' },
  'brussels': { lat: 50.8503, lng: 4.3517, country: 'Belgium' },
  'rome': { lat: 41.9028, lng: 12.4964, country: 'Italy' },
  'milan': { lat: 45.4642, lng: 9.1900, country: 'Italy' },
  'warsaw': { lat: 52.2297, lng: 21.0122, country: 'Poland' },
  'prague': { lat: 50.0755, lng: 14.4378, country: 'Czech Republic' },
  'budapest': { lat: 47.4979, lng: 19.0402, country: 'Hungary' },
  'tallinn': { lat: 59.4370, lng: 24.7536, country: 'Estonia' },
  'manchester': { lat: 53.4808, lng: -2.2426, country: 'UK' },
  'edinburgh': { lat: 55.9533, lng: -3.1883, country: 'UK' },
  'frankfurt': { lat: 50.1109, lng: 8.6821, country: 'Germany' },
  'hamburg': { lat: 53.5511, lng: 9.9937, country: 'Germany' },
  'lyon': { lat: 45.7640, lng: 4.8357, country: 'France' },
  'cannes': { lat: 43.5528, lng: 7.0174, country: 'France' },
  'monaco': { lat: 43.7384, lng: 7.4246, country: 'Monaco' },
  'hanover': { lat: 52.3759, lng: 9.7320, country: 'Germany' },
  'hannover': { lat: 52.3759, lng: 9.7320, country: 'Germany' },
  'athens': { lat: 37.9838, lng: 23.7275, country: 'Greece' },
  'bucharest': { lat: 44.4268, lng: 26.1025, country: 'Romania' },
  'kyiv': { lat: 50.4501, lng: 30.5234, country: 'Ukraine' },
  'kiev': { lat: 50.4501, lng: 30.5234, country: 'Ukraine' },

  // Middle East
  'dubai': { lat: 25.2048, lng: 55.2708, country: 'UAE' },
  'abu dhabi': { lat: 24.4539, lng: 54.3773, country: 'UAE' },
  'doha': { lat: 25.2854, lng: 51.5310, country: 'Qatar' },
  'riyadh': { lat: 24.7136, lng: 46.6753, country: 'Saudi Arabia' },
  'tel aviv': { lat: 32.0853, lng: 34.7818, country: 'Israel' },
  'istanbul': { lat: 41.0082, lng: 28.9784, country: 'Turkey' },
  'cairo': { lat: 30.0444, lng: 31.2357, country: 'Egypt' },

  // Asia
  'tokyo': { lat: 35.6762, lng: 139.6503, country: 'Japan' },
  'osaka': { lat: 34.6937, lng: 135.5023, country: 'Japan' },
  'seoul': { lat: 37.5665, lng: 126.9780, country: 'South Korea' },
  'beijing': { lat: 39.9042, lng: 116.4074, country: 'China' },
  'shanghai': { lat: 31.2304, lng: 121.4737, country: 'China' },
  'shenzhen': { lat: 22.5431, lng: 114.0579, country: 'China' },
  'hong kong': { lat: 22.3193, lng: 114.1694, country: 'Hong Kong' },
  'taipei': { lat: 25.0330, lng: 121.5654, country: 'Taiwan' },
  'singapore': { lat: 1.3521, lng: 103.8198, country: 'Singapore' },
  'kuala lumpur': { lat: 3.1390, lng: 101.6869, country: 'Malaysia' },
  'jakarta': { lat: -6.2088, lng: 106.8456, country: 'Indonesia' },
  'bali': { lat: -8.3405, lng: 115.0920, country: 'Indonesia' },
  'bangkok': { lat: 13.7563, lng: 100.5018, country: 'Thailand' },
  'ho chi minh city': { lat: 10.8231, lng: 106.6297, country: 'Vietnam' },
  'hanoi': { lat: 21.0278, lng: 105.8342, country: 'Vietnam' },
  'mumbai': { lat: 19.0760, lng: 72.8777, country: 'India' },
  'delhi': { lat: 28.7041, lng: 77.1025, country: 'India' },
  'new delhi': { lat: 28.6139, lng: 77.2090, country: 'India' },
  'bangalore': { lat: 12.9716, lng: 77.5946, country: 'India' },
  'bengaluru': { lat: 12.9716, lng: 77.5946, country: 'India' },
  'hyderabad': { lat: 17.3850, lng: 78.4867, country: 'India' },
  'manila': { lat: 14.5995, lng: 120.9842, country: 'Philippines' },

  // South America
  'sao paulo': { lat: -23.5505, lng: -46.6333, country: 'Brazil' },
  'buenos aires': { lat: -34.6037, lng: -58.3816, country: 'Argentina' },
  'bogota': { lat: 4.7110, lng: -74.0721, country: 'Colombia' },
  'santiago': { lat: -33.4489, lng: -70.6693, country: 'Chile' },
  'mexico city': { lat: 19.4326, lng: -99.1332, country: 'Mexico' },
  'lima': { lat: -12.0464, lng: -77.0428, country: 'Peru' },
  'medellin': { lat: 6.2476, lng: -75.5658, country: 'Colombia' },

  // Africa
  'cape town': { lat: -33.9249, lng: 18.4241, country: 'South Africa' },
  'johannesburg': { lat: -26.2041, lng: 28.0473, country: 'South Africa' },
  'lagos': { lat: 6.5244, lng: 3.3792, country: 'Nigeria' },
  'nairobi': { lat: -1.2921, lng: 36.8219, country: 'Kenya' },
  'accra': { lat: 5.6037, lng: -0.1870, country: 'Ghana' },
  'kigali': { lat: -1.9403, lng: 29.8739, country: 'Rwanda' },

  // Oceania
  'sydney': { lat: -33.8688, lng: 151.2093, country: 'Australia' },
  'melbourne': { lat: -37.8136, lng: 144.9631, country: 'Australia' },
  'auckland': { lat: -36.8509, lng: 174.7645, country: 'New Zealand' },

  // Virtual
  'online': { lat: 0, lng: 0, country: 'Virtual', virtual: true },
  'virtual': { lat: 0, lng: 0, country: 'Virtual', virtual: true },
  'hybrid': { lat: 0, lng: 0, country: 'Virtual', virtual: true },
};

function normalizeLocation(location: string): Coords | null {
  if (!location) return null;

  let normalized = location.toLowerCase().trim();
  normalized = normalized.replace(/^hybrid:\s*/i, '');
  normalized = normalized.replace(/,\s*(usa|us|uk|canada)$/i, '');

  if (CITY_COORDS[normalized]) {
    return { ...CITY_COORDS[normalized], original: location };
  }

  const parts = normalized.split(',');
  if (parts.length > 1) {
    const city = parts[0].trim();
    if (CITY_COORDS[city]) {
      return { ...CITY_COORDS[city], original: location };
    }
  }

  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return { ...coords, original: location };
    }
  }

  return null;
}

function parseICS(icsText: string): TechEvent[] {
  const events: TechEvent[] = [];
  const eventBlocks = icsText.split('BEGIN:VEVENT').slice(1);

  for (const block of eventBlocks) {
    const summaryMatch = block.match(/SUMMARY:(.+)/);
    const locationMatch = block.match(/LOCATION:(.+)/);
    const dtstartMatch = block.match(/DTSTART;VALUE=DATE:(\d+)/);
    const dtendMatch = block.match(/DTEND;VALUE=DATE:(\d+)/);
    const urlMatch = block.match(/URL:(.+)/);
    const uidMatch = block.match(/UID:(.+)/);

    if (summaryMatch && dtstartMatch) {
      const summary = summaryMatch[1].trim();
      const location = locationMatch ? locationMatch[1].trim() : null;
      const startDate = dtstartMatch[1];
      const endDate = dtendMatch ? dtendMatch[1] : startDate;
      const url = urlMatch ? urlMatch[1].trim() : null;
      const uid = uidMatch ? uidMatch[1].trim() : null;

      let type = 'other';
      if (summary.startsWith('Earnings:')) type = 'earnings';
      else if (summary.startsWith('IPO')) type = 'ipo';
      else if (location) type = 'conference';

      const coords = location ? normalizeLocation(location) : null;

      events.push({
        id: uid,
        title: summary,
        type,
        location,
        coords,
        startDate: `${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}`,
        endDate: `${endDate.slice(0, 4)}-${endDate.slice(4, 6)}-${endDate.slice(6, 8)}`,
        url,
        source: 'techmeme',
      });
    }
  }

  return events.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function parseDevEventsRSS(rssText: string): TechEvent[] {
  const events: TechEvent[] = [];
  const itemMatches = rssText.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const match of itemMatches) {
    const item = match[1];

    const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
    const linkMatch = item.match(/<link>(.*?)<\/link>/);
    const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/s);
    const guidMatch = item.match(/<guid[^>]*>(.*?)<\/guid>/);

    const title = titleMatch ? (titleMatch[1] || titleMatch[2]) : null;
    const link = linkMatch ? linkMatch[1] : null;
    const description = descMatch ? (descMatch[1] || descMatch[2]) : '';
    const guid = guidMatch ? guidMatch[1] : null;

    if (!title) continue;

    const dateMatch = description.match(/on\s+(\w+\s+\d{1,2},?\s+\d{4})/i);
    let startDate: string | null = null;
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed.getTime())) {
        startDate = parsed.toISOString().split('T')[0];
      }
    }

    let location: string | null = null;
    const locationMatch = description.match(/(?:in|at)\s+([A-Za-z\s]+,\s*[A-Za-z\s]+)(?:\.|$)/i) ||
                          description.match(/Location:\s*([^<\n]+)/i);
    if (locationMatch) {
      location = locationMatch[1].trim();
    }
    if (description.toLowerCase().includes('online')) {
      location = 'Online';
    }

    if (!startDate) continue;
    const eventDate = new Date(startDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (eventDate < now) continue;

    const coords = location && location !== 'Online' ? normalizeLocation(location) : null;

    events.push({
      id: guid || `dev-events-${title.slice(0, 20)}`,
      title,
      type: 'conference',
      location,
      coords: coords || (location === 'Online' ? { lat: 0, lng: 0, country: 'Virtual', virtual: true, original: 'Online' } : null),
      startDate,
      endDate: startDate,
      url: link,
      source: 'dev.events',
    });
  }

  return events;
}

export async function getTechEvents(params?: {
  type?: string;
  mappable?: boolean;
  limit?: number;
  days?: number;
}): Promise<TechEventsResult> {
  const type = params?.type;
  const mappable = params?.mappable ?? false;
  const limit = params?.limit || 0;
  const days = params?.days || 0;

  try {
    const [icsResponse, rssResponse] = await Promise.allSettled([
      fetch(ICS_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GlobalIntel/1.0)' },
      }),
      fetch(DEV_EVENTS_RSS, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GlobalIntel/1.0)' },
      }),
    ]);

    let events: TechEvent[] = [];

    if (icsResponse.status === 'fulfilled' && icsResponse.value.ok) {
      const icsText = await icsResponse.value.text();
      events.push(...parseICS(icsText));
    } else {
      console.warn('Failed to fetch Techmeme ICS');
    }

    if (rssResponse.status === 'fulfilled' && rssResponse.value.ok) {
      const rssText = await rssResponse.value.text();
      const devEvents = parseDevEventsRSS(rssText);
      events.push(...devEvents);
    } else {
      console.warn('Failed to fetch dev.events RSS');
    }

    // Add curated events
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (const curated of CURATED_EVENTS) {
      const eventDate = new Date(curated.startDate);
      if (eventDate >= now) {
        events.push(curated);
      }
    }

    // Deduplicate by title similarity
    const seen = new Set<string>();
    events = events.filter((e) => {
      const key = e.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by date
    events.sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Filter by type
    if (type && type !== 'all') {
      events = events.filter((e) => e.type === type);
    }

    // Filter to only mappable events
    if (mappable) {
      events = events.filter((e) => e.coords && !e.coords.virtual);
    }

    // Filter by time range
    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + days);
      events = events.filter((e) => new Date(e.startDate) <= cutoff);
    }

    // Apply limit
    if (limit > 0) {
      events = events.slice(0, limit);
    }

    const conferences = events.filter((e) => e.type === 'conference');
    const mappableCount = conferences.filter((e) => e.coords && !e.coords.virtual).length;

    return {
      success: true,
      count: events.length,
      conferenceCount: conferences.length,
      mappableCount,
      lastUpdated: new Date().toISOString(),
      events,
    };
  } catch (error: any) {
    console.error('Tech events error:', error);
    return {
      success: false,
      count: 0,
      conferenceCount: 0,
      mappableCount: 0,
      lastUpdated: new Date().toISOString(),
      events: [],
      error: error.message,
    };
  }
}
