const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Remove repeated words/phrases from LLM output (e.g. "지식지식지식" → "지식") */
function dedupeRepeats(text: string): string {
  // Match a substring of 1-10 chars repeated 3+ times consecutively
  return text.replace(/(.{1,10})\1{2,}/g, '$1');
}

const LANG_NAMES: Record<string, string> = {
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese (Simplified)",
  tc: "Chinese (Traditional)",
  es: "Spanish",
  fr: "French",
  de: "German",
  ru: "Russian",
  pt: "Portuguese",
  it: "Italian",
  vi: "Vietnamese",
  id: "Indonesian",
  tr: "Turkish",
  pl: "Polish",
  nl: "Dutch",
  uk: "Ukrainian",
  ar: "Arabic",
  sv: "Swedish",
};

// Cache: key = `${lang}:${text}` → translated text
const cache = new Map<string, string>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const cacheTimestamps = new Map<string, number>();

export async function translateTexts(
  texts: string[],
  targetLang: string
): Promise<string[]> {
  if (!GROQ_API_KEY || targetLang === "en") {
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

  // Batch translate uncached texts — all batches run in parallel
  const uncachedTexts = uncachedIndices.map((i) => texts[i]);
  const BATCH_SIZE = 50;
  const langName = LANG_NAMES[targetLang] || targetLang;

  const batchPromises: Promise<void>[] = [];

  for (let b = 0; b < uncachedTexts.length; b += BATCH_SIZE) {
    const batch = uncachedTexts.slice(b, b + BATCH_SIZE);
    const batchIndices = uncachedIndices.slice(b, b + BATCH_SIZE);
    const prompt = `Translate the following English texts to ${langName}. Return ONLY the translations, one per line, in the same order. Do not add numbering or explanations.\n\n${batch.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;

    batchPromises.push(
      (async (bIdx: number[]) => {
        for (let retry = 0; retry < 3; retry++) {
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
                temperature: 0.1,
                max_tokens: 4000,
                frequency_penalty: 0.5,
              }),
            });

            if (res.status === 429) {
              console.warn(`[translate] Rate limited, waiting 2s (retry ${retry + 1}/3)...`);
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            if (!res.ok) {
              console.error(`[translate] Groq error: ${res.status}`);
              return;
            }

            const data = await res.json();
            const content = data.choices?.[0]?.message?.content?.trim() || "";
            const lines = content
              .split("\n")
              .map((l: string) => l.replace(/^\d+\.\s*/, "").trim())
              .filter((l: string) => l.length > 0);

            bIdx.forEach((origIdx, i) => {
              let translated = lines[i] || texts[origIdx];
              // Detect and fix repeated words/phrases (e.g. "지식지식지식지식")
              translated = dedupeRepeats(translated);
              const key = `${targetLang}:${texts[origIdx]}`;
              cache.set(key, translated);
              cacheTimestamps.set(key, Date.now());
              results[origIdx] = translated;
            });
            return;
          } catch (err) {
            console.error("[translate] Batch failed:", err);
          }
        }
      })(batchIndices)
    );
  }

  await Promise.all(batchPromises);

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

  return results.map((r, i) => r || texts[i]) as string[];
}
