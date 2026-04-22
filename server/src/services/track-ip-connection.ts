import { getDb } from "../db/client.js";
import { ipConnectionLog } from "../db/schema.js";

export type TrackIpConnectionInput = {
  wallet: string;
  ip: string;
  city?: string | null;
  country?: string | null;
};

export async function trackIpConnection(
  input: TrackIpConnectionInput,
): Promise<{ success: true }> {
  const db = getDb();
  await db.insert(ipConnectionLog).values({
    wallet: input.wallet.toLowerCase(),
    ip: input.ip,
    city: input.city ?? null,
    country: input.country ?? null,
  });
  return { success: true as const };
}
