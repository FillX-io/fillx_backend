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
  const accountName = input.chainType === "evm" ? "Ethereum" : "Solana";
  const sessionResource = new URL("/session", input.uri).toString();
  const actionResource = `fillx:session:action:${input.action.replaceAll(
    "_",
    "-",
  )}`;

  const lines = [
    `${input.domain} wants you to sign in with your ${accountName} account:`,
    input.walletAddress,
    "",
    "Sign in to FillX. This will not create a transaction or move funds.",
    "",
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
  ];

  if (input.chainId !== null) {
    lines.push(`Chain ID: ${input.chainId}`);
  }

  lines.push(
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
    "Resources:",
    `- ${sessionResource}`,
    `- ${actionResource}`,
  );

  return lines.join("\n");
}
