import assert from "node:assert/strict";
import test from "node:test";
import { userIdentityFromAuth } from "./context.js";

test("userIdentityFromAuth maps FillX session auth to FillX user identity", () => {
  assert.deepEqual(
    userIdentityFromAuth({
      type: "fillx",
      session: {
        familyId: "family-1",
        walletSessionId: "wallet-session-1",
        walletKey: "evm:0x0000000000000000000000000000000000000001",
        userId: "user-123",
        expiresAt: new Date("2026-06-06T00:00:00.000Z"),
      },
    }),
    { type: "fillx", userId: "user-123" },
  );
});

test("userIdentityFromAuth keeps provider auth anonymous until resolved", () => {
  assert.deepEqual(
    userIdentityFromAuth({
      type: "privy",
      privy: { privyUserId: "did:privy:user", sessionId: "session-1" },
    }),
    { type: "anonymous" },
  );
});
