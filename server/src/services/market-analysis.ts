const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Cache: key = `${type}:${symbol}:${strategy}:${indicators}` → response
const cache = new Map<string, { data: string; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface AnalysisParams {
  type: "analyze" | "plan";
  symbol?: string;
  strategy?: string;
  indicators?: string[];
  lang?: string;
}

function buildPrompt(params: AnalysisParams): string {
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

  if (type === "analyze") {
    return `You are a professional crypto market analyst. Analyze the current market conditions for ${symbol}.

${strategyContext}
${indicatorContext}

Provide a comprehensive analysis including:
1. **Market Analysis Summary** - Current price context and market state
2. **Technical Assessment** - Trend, momentum, volatility analysis
3. **Key Levels** - Support and resistance levels to monitor
4. **Market Perspective** - Potential scenarios and developments
5. **Risk Awareness** - Market risks and analysis limitations

Format your response in clean markdown with headers and bullet points.
Keep it concise but thorough.${langInstruction}`;
  }

  // type === "plan"
  return `You are a professional crypto trading strategist. Create a trading plan for ${symbol}.

${strategyContext}
${indicatorContext}

Provide a detailed trading plan including:
1. **Trade Setup** - Entry conditions and rationale
2. **Entry Points** - Specific price levels for entry
3. **Stop Loss** - Where to place stop loss and why
4. **Take Profit** - Target levels with risk/reward ratio
5. **Position Sizing** - Recommended position size guidelines
6. **Risk Management** - Maximum risk per trade

Format your response in clean markdown with headers and bullet points.
Include specific price levels where possible.${langInstruction}

*Disclaimer: This is for educational purposes only. Not financial advice.*`;
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

  const prompt = buildPrompt(params);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
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
