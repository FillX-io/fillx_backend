// YouTube Live Stream Detection service
// Checks if a YouTube channel has an active live stream

interface YouTubeLiveResult {
  videoId: string | null;
  isLive?: boolean;
  error?: string;
}

interface CacheEntry {
  data: YouTubeLiveResult;
  timestamp: number;
}

const cacheMap = new Map<string, CacheEntry>();
const CACHE_TTL = 300_000; // 5 minutes

export async function checkYouTubeLive(channel: string): Promise<YouTubeLiveResult> {
  if (!channel) {
    throw new Error('Missing channel parameter');
  }

  const now = Date.now();
  const cached = cacheMap.get(channel);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const channelHandle = channel.startsWith('@') ? channel : `@${channel}`;
    const liveUrl = `https://www.youtube.com/${channelHandle}/live`;

    const response = await fetch(liveUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      const result: YouTubeLiveResult = { videoId: null };
      return result;
    }

    const html = await response.text();

    // Extract video ID from the page
    const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    const isLiveMatch = html.match(/"isLive":\s*true/);

    let result: YouTubeLiveResult;

    if (videoIdMatch && isLiveMatch) {
      result = { videoId: videoIdMatch[1], isLive: true };
    } else {
      result = { videoId: null, isLive: false };
    }

    cacheMap.set(channel, { data: result, timestamp: now });

    return result;
  } catch (error) {
    console.error('YouTube live check error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { videoId: null, error: message };
  }
}
