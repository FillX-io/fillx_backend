/**
 * Story Page Service
 * Generates HTML with OG meta tags for social crawlers.
 * Real users get redirected to the SPA.
 */

const COUNTRY_NAMES: Record<string, string> = {
  UA: 'Ukraine', RU: 'Russia', CN: 'China', US: 'United States',
  IR: 'Iran', IL: 'Israel', TW: 'Taiwan', KP: 'North Korea',
  SA: 'Saudi Arabia', TR: 'Turkey', PL: 'Poland', DE: 'Germany',
  FR: 'France', GB: 'United Kingdom', IN: 'India', PK: 'Pakistan',
  SY: 'Syria', YE: 'Yemen', MM: 'Myanmar', VE: 'Venezuela',
};

const BOT_UA = /twitterbot|facebookexternalhit|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|redditbot|googlebot/i;

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface StoryParams {
  c?: string;
  t?: string;
  ts?: string;
  s?: string;
  l?: string;
}

interface StoryResult {
  type: 'redirect' | 'html';
  url?: string;
  html?: string;
}

export function generateStoryPage(params: StoryParams, userAgent: string, host: string): StoryResult {
  const countryCode = (params.c || '').toUpperCase();
  const type = params.t || 'ciianalysis';
  const ts = params.ts || '';
  const score = params.s || '';
  const level = params.l || '';

  const isBot = BOT_UA.test(userAgent);

  const baseUrl = `https://${host}`;
  const spaUrl = `${baseUrl}/?c=${countryCode}&t=${type}${ts ? `&ts=${ts}` : ''}`;

  // Real users -> redirect to SPA
  if (!isBot) {
    return { type: 'redirect', url: spaUrl };
  }

  // Bots -> serve meta tags
  const countryName = COUNTRY_NAMES[countryCode] || countryCode || 'Global';
  const title = `${countryName} Intelligence Brief | Global Intel`;
  const description = `Real-time instability analysis for ${countryName}. Country Instability Index, military posture, threat classification, and prediction markets. Free, open-source geopolitical intelligence.`;
  const imageParams = `c=${countryCode}&t=${type}${score ? `&s=${score}` : ''}${level ? `&l=${level}` : ''}`;
  const imageUrl = `${baseUrl}/api/og-story?${imageParams}`;
  const storyUrl = `${baseUrl}/api/story?c=${countryCode}&t=${type}${ts ? `&ts=${ts}` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}"/>

  <meta property="og:type" content="article"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:image" content="${esc(imageUrl)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url" content="${esc(storyUrl)}"/>
  <meta property="og:site_name" content="Global Intel"/>

  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:site" content="@pacifica_fi"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(description)}"/>
  <meta name="twitter:image" content="${esc(imageUrl)}"/>

  <link rel="canonical" href="${esc(storyUrl)}"/>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p>${esc(description)}</p>
  <p><a href="${esc(spaUrl)}">View live analysis</a></p>
</body>
</html>`;

  return { type: 'html', html };
}
