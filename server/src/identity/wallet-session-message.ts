import type { ChainType } from "../db/schema.js";

export type WalletSessionMessageInput = {
  domain: string;
  walletAddress: string;
  action: "sign_in";
  uri: string;
  version: "1";
  chainType: ChainType;
  chainId: number | null;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export function buildWalletSessionMessage(
  input: WalletSessionMessageInput,
): string {
  return [
    `${input.domain} wants you to sign in to FillX:`,
    "",
    `Wallet: ${input.walletAddress}`,
    `Action: ${input.action}`,
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Chain Type: ${input.chainType}`,
    `Chain ID: ${input.chainId ?? "n/a"}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
}
