import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import {
  FILLX_SESSION_COOKIE,
  setFillxSessionCookie,
  signFillxSession,
  verifyFillxSessionToken,
} from "./session.js";

const TEST_NOW = new Date("2026-05-07T00:00:00.000Z");
const VERY_LONG_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 100;

test("signFillxSession creates a JWT that verifies to the FillX user id", async () => {
  const token = await signFillxSession({
    userId: "user-123",
    secret: "test-secret",
    now: TEST_NOW,
    maxAgeSeconds: VERY_LONG_MAX_AGE_SECONDS,
  });

  const verified = await verifyFillxSessionToken({
    token,
    secret: "test-secret",
  });

  assert.deepEqual(verified, { userId: "user-123" });
});

test("verifyFillxSessionToken rejects tokens signed with a different algorithm", async () => {
  const token = await new SignJWT({ typ: "fillx-session" })
    .setProtectedHeader({ alg: "HS384" })
    .setSubject("user-123")
    .setIssuedAt(Math.floor(TEST_NOW.getTime() / 1000))
    .setExpirationTime(
      Math.floor(TEST_NOW.getTime() / 1000) + VERY_LONG_MAX_AGE_SECONDS,
    )
    .sign(new TextEncoder().encode("test-secret"));

  assert.equal(
    await verifyFillxSessionToken({
      token,
      secret: "test-secret",
    }),
    null,
  );
});

test("verifyFillxSessionToken returns null for invalid tokens", async () => {
  assert.equal(
    await verifyFillxSessionToken({
      token: "not-a-jwt",
      secret: "test-secret",
    }),
    null,
  );
});

test("setFillxSessionCookie sets browser-safe cookie attributes", () => {
  const headers = new Headers();

  setFillxSessionCookie(headers, "jwt-value", {
    secure: true,
    maxAgeSeconds: 60,
  });

  const cookie = headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`${FILLX_SESSION_COOKIE}=jwt-value`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=60/);
});
