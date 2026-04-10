const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const COINGECKO_URL = "https://api.coingecko.com/api/v3";

const LANG_NAMES: Record<string, string> = {
  ko: "Korean", ja: "Japanese", zh: "Chinese", es: "Spanish",
  fr: "French", de: "German", ru: "Russian", pt: "Portuguese",
  it: "Italian", vi: "Vietnamese", tr: "Turkish", pl: "Polish",
  nl: "Dutch", uk: "Ukrainian", ar: "Arabic",
};

async function translateBlock(text: string, targetLang: string): Promise<string> {
  if (!GROQ_API_KEY || targetLang === "en") return text;
  const langName = LANG_NAMES[targetLang] || targetLang;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{
          role: "user",
          content: `Translate the following market analysis text to ${langName}. Keep all markdown formatting (## headers, **bold**, etc) exactly as-is. Only translate the text content. Do not add any commentary.\n\n${text}`,
        }],
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });
    if (!res.ok) return text;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

// Cache: key = `${type}:${symbol}:${strategy}:${indicators}:${lang}` → response
const cache = new Map<string, { data: string; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
  XRP: "ripple",
};

const ORDERLY_SYMBOL_MAP: Record<string, string> = {
  BTC: "PERP_BTC_USDC",
  ETH: "PERP_ETH_USDC",
  SOL: "PERP_SOL_USDC",
};

async function fetchOHLCV(symbol: string): Promise<string> {
  const orderlySymbol = ORDERLY_SYMBOL_MAP[symbol];
  if (!orderlySymbol) return "";
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 2 * 60 * 60; // last 2 hours
    const res = await fetch(
      `https://api-evm.orderly.org/v1/tv/kline_history?symbol=${orderlySymbol}&resolution=5m&from=${from}&to=${to}`
    );
    if (!res.ok) return "";
    const data = await res.json();
    if (data.s !== "ok" || !data.o) return "";

    const len = data.o.length;
    const latest = {
      open: data.o[len - 1],
      close: data.c[len - 1],
      high: data.h[len - 1],
      low: data.l[len - 1],
      volume: data.v[len - 1],
    };
    const periodHigh = Math.max(...data.h);
    const periodLow = Math.min(...data.l);
    const totalVolume = data.v.reduce((a: number, b: number) => a + b, 0);

    return `
OHLCV Data (last 2 hours, 5-min candles, ${len} data points):
- Latest candle: Open $${latest.open.toFixed(2)}, Close $${latest.close.toFixed(2)}, High $${latest.high.toFixed(2)}, Low $${latest.low.toFixed(2)}
- 2h High: $${periodHigh.toFixed(2)}
- 2h Low: $${periodLow.toFixed(2)}
- 2h Range: $${(periodHigh - periodLow).toFixed(2)} (${((periodHigh - periodLow) / periodLow * 100).toFixed(2)}%)
- 2h Total Volume: ${totalVolume.toFixed(4)} ${symbol}
- Trend: ${data.c[len - 1] > data.o[0] ? "Upward" : data.c[len - 1] < data.o[0] ? "Downward" : "Sideways"} (from $${data.o[0].toFixed(2)} to $${data.c[len - 1].toFixed(2)})
`.trim();
  } catch {
    return "";
  }
}

async function fetchMarketData(symbol: string): Promise<string> {
  const coinId = SYMBOL_TO_COINGECKO[symbol] || "bitcoin";
  try {
    const res = await fetch(
      `${COINGECKO_URL}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    if (!res.ok) return "";
    const data = await res.json();
    const md = data.market_data;
    if (!md) return "";
    return `
Current Market Data for ${symbol}:
- Price: $${md.current_price?.usd?.toLocaleString() ?? "N/A"}
- 24h Change: ${md.price_change_percentage_24h?.toFixed(2) ?? "N/A"}%
- 24h High: $${md.high_24h?.usd?.toLocaleString() ?? "N/A"}
- 24h Low: $${md.low_24h?.usd?.toLocaleString() ?? "N/A"}
- 24h Volume: $${(md.total_volume?.usd / 1e6)?.toFixed(1) ?? "N/A"}M
- Market Cap: $${(md.market_cap?.usd / 1e9)?.toFixed(1) ?? "N/A"}B
- ATH: $${md.ath?.usd?.toLocaleString() ?? "N/A"}
- ATH Change: ${md.ath_change_percentage?.usd?.toFixed(1) ?? "N/A"}%
`.trim();
  } catch {
    return "";
  }
}

interface AnalysisParams {
  type: "analyze" | "plan";
  symbol?: string;
  strategy?: string;
  indicators?: string[];
  lang?: string;
  question?: string;
}

function buildPrompt(params: AnalysisParams, marketData: string): string {
  const { type, symbol = "BTC", strategy, indicators, lang } = params;

  const langInstruction = "";

  const strategyContext = strategy
    ? `\nThe user has selected the "${strategy}" strategy. Tailor your analysis to this strategy's approach.`
    : "";

  const indicatorContext = indicators && indicators.length > 0
    ? `\nFocus your analysis on these technical indicators: ${indicators.join(", ")}. Provide specific values and interpretations for each.`
    : "\nNo specific indicators selected. Provide a general technical analysis.";

  const dataContext = marketData ? `\n\n${marketData}` : "";

  // Free-form question mode
  if (params.question) {
    return `You are a professional crypto trading assistant. The user asks: "${params.question}"
${dataContext}
${strategyContext}
${indicatorContext}

Answer the user's question using the market data above. Be specific and helpful. Use "##" for section headers if needed. Write naturally.`;
  }

  if (type === "analyze") {
    return `You are a professional crypto market analyst writing for traders. Below is real-time data for ${symbol}. Use this data to write an insightful analysis. Do NOT just repeat the numbers — interpret them, explain what they mean, and give actionable insights.
${dataContext}
${strategyContext}
${indicatorContext}

Write your analysis as flowing paragraphs under these headers (use "##" only, no "###" or "####"):

## Summary
Write 2-3 sentences interpreting the current price action and market sentiment.

## Technical Assessment
Explain the trend, momentum, and what the indicators suggest about the next move.

## Key Levels
Identify specific support and resistance levels and explain why they matter.

## Outlook
Describe the most likely scenario and key risks to watch.

Write naturally like a market analyst, not a data dump.${langInstruction}`;
  }

  return `You are a professional crypto trading strategist. Below is real-time data for ${symbol}. Use this data to create a specific, actionable trading plan. Do NOT just repeat numbers — provide concrete recommendations.
${dataContext}
${strategyContext}
${indicatorContext}

Write your plan as flowing paragraphs under these headers (use "##" only, no "###" or "####"):

## Trade Setup
Explain the entry conditions and reasoning based on the current data.

## Entry & Exit
Give specific entry price, stop loss, and take profit levels with risk/reward ratio.

## Risk Management
Recommend position sizing and maximum risk guidelines.

Write naturally like a trading strategist giving advice.${langInstruction}

Disclaimer: Educational purposes only. Not financial advice.`;
}

export async function analyzeMarket(params: AnalysisParams): Promise<{ content: string; cached: boolean }> {
  if (!GROQ_API_KEY) {
    return { content: "Groq API key not configured.", cached: false };
  }

  const hasQuestion = !!params.question;
  const cacheKey = `${params.type}:${params.symbol || "BTC"}:${params.strategy || ""}:${(params.indicators || []).sort().join(",")}:${params.lang || "en"}`;
  if (!hasQuestion) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      return { content: cached.data, cached: true };
    }
  }

  const [marketData, ohlcvData] = await Promise.all([
    fetchMarketData(params.symbol || "BTC"),
    fetchOHLCV(params.symbol || "BTC"),
  ]);
  const combinedData = [marketData, ohlcvData].filter(Boolean).join("\n\n");
  const prompt = buildPrompt(params, combinedData);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!res.ok) {
      console.error(`[market-analysis] Groq error: ${res.status}`);
      return { content: "Analysis temporarily unavailable. Please try again.", cached: false };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "No analysis generated.";

    // Cache the result
    cache.set(cacheKey, { data: content, expires: Date.now() + CACHE_TTL });

    // Cleanup old entries
    if (cache.size > 100) {
      const now = Date.now();
      for (const [k, v] of cache) {
        if (now > v.expires) cache.delete(k);
      }
    }

    // Translate if not English
    const lang = params.lang || "en";
    if (lang !== "en") {
      const translatedContent = await translateBlock(content, lang);
      cache.set(cacheKey, { data: translatedContent, expires: Date.now() + CACHE_TTL });
      return { content: translatedContent, cached: false };
    }

    return { content, cached: false };
  } catch (err) {
    console.error("[market-analysis] Failed:", err);
    return { content: "Analysis failed. Please try again.", cached: false };
  }
}
