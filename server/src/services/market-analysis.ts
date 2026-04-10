const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const COINGECKO_URL = "https://api.coingecko.com/api/v3";

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
}

function buildPrompt(params: AnalysisParams, marketData: string): string {
  const { type, symbol = "BTC", strategy, indicators, lang } = params;

  const langInstruction = lang && lang !== "en"
    ? `\n\nIMPORTANT: Respond entirely in ${lang} language.`
    : "";

  const strategyContext = strategy
    ? `\nThe user has selected the "${strategy}" strategy. Tailor your analysis to this strategy's approach.`
    : "";

  const indicatorContext = indicators && indicators.length > 0
    ? `\nFocus your analysis on these technical indicators: ${indicators.join(", ")}. Provide specific values and interpretations for each.`
    : "\nNo specific indicators selected. Provide a general technical analysis.";

  const dataContext = marketData ? `\n\n${marketData}` : "";

  if (type === "analyze") {
    return `You are a professional crypto market analyst. Analyze the current market conditions for ${symbol}.
${dataContext}
${strategyContext}
${indicatorContext}

Write a concise market analysis with these sections. Use plain text with minimal formatting. Use "##" for section headers only. Do NOT use "###" or "####". Write in paragraphs, not bullet lists.

Sections:
## Summary
(2-3 sentences about current market state)

## Technical Assessment
(Trend direction, key indicator values, momentum)

## Key Levels
(Support and resistance prices)

## Outlook
(Most likely scenario and risks)

Keep the total response under 500 words.${langInstruction}`;
  }

  return `You are a professional crypto trading strategist. Create a trading plan for ${symbol}.
${dataContext}
${strategyContext}
${indicatorContext}

Write a concise trading plan with these sections. Use plain text with minimal formatting. Use "##" for section headers only. Do NOT use "###" or "####". Write in paragraphs, not bullet lists.

Sections:
## Trade Setup
(Entry conditions and rationale)

## Entry & Exit
(Entry price, stop loss price, take profit price, risk/reward ratio)

## Risk Management
(Position size guideline, maximum risk)

Keep the total response under 400 words.${langInstruction}

Disclaimer: Educational purposes only. Not financial advice.`;
}

export async function analyzeMarket(params: AnalysisParams): Promise<{ content: string; cached: boolean }> {
  if (!GROQ_API_KEY) {
    return { content: "Groq API key not configured.", cached: false };
  }

  const cacheKey = `${params.type}:${params.symbol || "BTC"}:${params.strategy || ""}:${(params.indicators || []).sort().join(",")}:${params.lang || "en"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return { content: cached.data, cached: true };
  }

  const marketData = await fetchMarketData(params.symbol || "BTC");
  const prompt = buildPrompt(params, marketData);

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

    return { content, cached: false };
  } catch (err) {
    console.error("[market-analysis] Failed:", err);
    return { content: "Analysis failed. Please try again.", cached: false };
  }
}
