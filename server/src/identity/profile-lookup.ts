import { normalizeWalletAddress } from "./wallet.js";

export function normalizeProfileLookupWallets(walletAddresses: string[]): string[] {
  const normalized = new Set<string>();
  for (const raw of walletAddresses) {
    try {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      const chainType = lower.startsWith("0x") ? "evm" : "solana";
      const walletAddress = chainType === "evm" ? lower : trimmed;
      normalized.add(normalizeWalletAddress(chainType, walletAddress));
    } catch {
      continue;
    }
  }
  return [...normalized];
}
