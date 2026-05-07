import assert from "node:assert/strict";
import test from "node:test";
import { userIdentityFromAuth } from "./context.js";

test("userIdentityFromAuth maps FillX session auth to FillX user identity", () => {
  assert.deepEqual(
    userIdentityFromAuth({
      type: "fillx",
      session: { userId: "user-123" },
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
