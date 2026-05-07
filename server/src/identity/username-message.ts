import type { ChainType } from "../db/schema.js";

export type UsernameClaimMessageInput = {
  domain: string;
  walletAddress: string;
  action: "claim_username";
  username: string;
  uri: string;
  version: "1";
  chainType: ChainType;
  chainId: number | null;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export function buildUsernameClaimMessage(
  input: UsernameClaimMessageInput,
): string {
  return [
    `${input.domain} wants you to claim a FillX username:`,
    "",
    `Wallet: ${input.walletAddress}`,
    `Action: ${input.action}`,
    `Username: ${input.username}`,
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Chain Type: ${input.chainType}`,
    `Chain ID: ${input.chainId ?? "n/a"}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
}
