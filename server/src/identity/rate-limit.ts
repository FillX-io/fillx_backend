type Bucket = { count: number; resetAt: number };

export function createMemoryRateLimiter(options: { now?: () => number } = {}) {
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  return {
    check(input: {
      key: string;
      limit: number;
      windowMs: number;
    }): { allowed: boolean; remaining: number; resetAt: number } {
      const current = now();
      const existing = buckets.get(input.key);
      const bucket =
        !existing || existing.resetAt <= current
          ? { count: 0, resetAt: current + input.windowMs }
          : existing;
      bucket.count += 1;
      buckets.set(input.key, bucket);

      return {
        allowed: bucket.count <= input.limit,
        remaining: Math.max(0, input.limit - bucket.count),
        resetAt: bucket.resetAt,
      };
    },
  };
}

export const identityRateLimiter = createMemoryRateLimiter();
