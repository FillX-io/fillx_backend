import { normalizeWalletAddress } from "./wallet.js";

export function normalizeProfileLookupWallets(walletAddresses: string[]): string[] {
  const normalized = new Set<string>();
  for (const raw of walletAddresses) {
    try {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      const chainType = lower.startsWith("0x") ? "evm" : "solana";
      normalized.add(normalizeWalletAddress(chainType, trimmed));
    } catch {
      continue;
    }
  }
  return [...normalized];
}
