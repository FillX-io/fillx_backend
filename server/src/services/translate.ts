const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Cache: key = `${lang}:${text}` → translated text
const cache = new Map<string, string>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const cacheTimestamps = new Map<string, number>();

export async function translateTexts(
  texts: string[],
  targetLang: string
): Promise<string[]> {
  if (!OPENROUTER_API_KEY || targetLang === "en") {
    return texts;
  }

  // Check cache
  const results: (string | null)[] = texts.map((text) => {
    const key = `${targetLang}:${text}`;
    const cached = cache.get(key);
    const ts = cacheTimestamps.get(key);
    if (cached && ts && Date.now() - ts < CACHE_TTL) return cached;
    return null;
  });

  const uncachedIndices = results
    .map((r, i) => (r === null ? i : -1))
    .filter((i) => i >= 0);

  if (uncachedIndices.length === 0) {
    return results as string[];
  }

  // Batch translate uncached texts
  const uncachedTexts = uncachedIndices.map((i) => texts[i]);
  const prompt = `Translate the following texts to ${targetLang}. Return ONLY the translations, one per line, in the same order. Do not add numbering or explanations.\n\n${uncachedTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct:free",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      console.error(`[translate] OpenRouter error: ${res.status}`);
      return texts;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const lines = content
      .split("\n")
      .map((l: string) => l.replace(/^\d+\.\s*/, "").trim())
      .filter((l: string) => l.length > 0);

    // Update cache and results
    uncachedIndices.forEach((origIdx, i) => {
      const translated = lines[i] || texts[origIdx];
      const key = `${targetLang}:${texts[origIdx]}`;
      cache.set(key, translated);
      cacheTimestamps.set(key, Date.now());
      results[origIdx] = translated;
    });

    // Cleanup old cache entries
    if (cache.size > 5000) {
      const now = Date.now();
      for (const [k, ts] of cacheTimestamps) {
        if (now - ts > CACHE_TTL) {
          cache.delete(k);
          cacheTimestamps.delete(k);
        }
      }
    }
  } catch (err) {
    console.error("[translate] Failed:", err);
    return texts;
  }

  return results.map((r, i) => r || texts[i]) as string[];
}
