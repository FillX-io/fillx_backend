import assert from "node:assert/strict";
import test from "node:test";
import { buildWalletSessionMessage } from "./wallet-session-message.js";

test("buildWalletSessionMessage formats EVM sign-in as SIWE-readable text", () => {
  const message = buildWalletSessionMessage({
    domain: "app.fillx.trade",
    walletAddress: "0x0000000000000000000000000000000000000001",
    action: "sign_in",
    uri: "https://app.fillx.trade/session/sign-in",
    version: "1",
    chainType: "evm",
    chainId: 1,
    nonce: "nonce-1",
    issuedAt: "2026-05-07T12:00:00.000Z",
    expiresAt: "2026-05-07T12:10:00.000Z",
  });

  assert.equal(
    message,
    [
      "app.fillx.trade wants you to sign in with your Ethereum account:",
      "0x0000000000000000000000000000000000000001",
      "",
      "Sign in to FillX. This will not create a transaction or move funds.",
      "",
      "URI: https://app.fillx.trade/session/sign-in",
      "Version: 1",
      "Chain ID: 1",
      "Nonce: nonce-1",
      "Issued At: 2026-05-07T12:00:00.000Z",
      "Expiration Time: 2026-05-07T12:10:00.000Z",
      "Resources:",
      "- https://app.fillx.trade/session",
      "- fillx:session:action:sign-in",
    ].join("\n"),
  );
});

test("buildWalletSessionMessage formats Solana sign-in as SIWS-readable text", () => {
  const message = buildWalletSessionMessage({
    domain: "app.fillx.trade",
    walletAddress: "11111111111111111111111111111111",
    action: "sign_in",
    uri: "https://app.fillx.trade/session/sign-in",
    version: "1",
    chainType: "solana",
    chainId: null,
    nonce: "nonce-1",
    issuedAt: "2026-05-07T12:00:00.000Z",
    expiresAt: "2026-05-07T12:10:00.000Z",
  });

  assert.equal(
    message,
    [
      "app.fillx.trade wants you to sign in with your Solana account:",
      "11111111111111111111111111111111",
      "",
      "Sign in to FillX. This will not create a transaction or move funds.",
      "",
      "URI: https://app.fillx.trade/session/sign-in",
      "Version: 1",
      "Nonce: nonce-1",
      "Issued At: 2026-05-07T12:00:00.000Z",
      "Expiration Time: 2026-05-07T12:10:00.000Z",
      "Resources:",
      "- https://app.fillx.trade/session",
      "- fillx:session:action:sign-in",
    ].join("\n"),
  );
});
