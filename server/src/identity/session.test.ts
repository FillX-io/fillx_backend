import assert from "node:assert/strict";
import test from "node:test";
import {
  DEV_FILLX_SESSION_COOKIE,
  LEGACY_FILLX_SESSION_COOKIE,
  SECURE_FILLX_SESSION_COOKIE,
  clearFillxSessionCookies,
  createOpaqueSessionToken,
  hashOpaqueSessionToken,
  readFillxSessionCookie,
  setFillxSessionCookie,
} from "./session.js";

test("createOpaqueSessionToken returns non-JWT random tokens", () => {
  const first = createOpaqueSessionToken();
  const second = createOpaqueSessionToken();

  assert.notEqual(first, second);
  assert.equal(first.includes("."), false);
  assert.ok(first.length >= 43);
});

test("hashOpaqueSessionToken hashes tokens deterministically without storing raw value", () => {
  const token = "opaque-token";
  const hash = hashOpaqueSessionToken(token);

  assert.equal(hash, hashOpaqueSessionToken(token));
  assert.notEqual(hash, token);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test("setFillxSessionCookie uses the secure host cookie name when Secure is enabled", () => {
  const headers = new Headers();

  setFillxSessionCookie(headers, "opaque-value", {
    secure: true,
    maxAgeSeconds: 60,
  });

  const cookie = headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`${SECURE_FILLX_SESSION_COOKIE}=opaque-value`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=60/);
});

test("setFillxSessionCookie uses the dev cookie name without Secure locally", () => {
  const headers = new Headers();

  setFillxSessionCookie(headers, "opaque-value", {
    secure: false,
    maxAgeSeconds: 60,
  });

  const cookie = headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`${DEV_FILLX_SESSION_COOKIE}=opaque-value`));
  assert.doesNotMatch(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
});

test("readFillxSessionCookie accepts secure, dev, and legacy cookie names", () => {
  const headers = new Headers();
  headers.set(
    "cookie",
    [
      `${LEGACY_FILLX_SESSION_COOKIE}=legacy`,
      `${DEV_FILLX_SESSION_COOKIE}=dev`,
      `${SECURE_FILLX_SESSION_COOKIE}=secure`,
    ].join("; "),
  );

  assert.equal(readFillxSessionCookie(headers), "secure");

  headers.set(
    "cookie",
    `${LEGACY_FILLX_SESSION_COOKIE}=legacy; ${DEV_FILLX_SESSION_COOKIE}=dev`,
  );
  assert.equal(readFillxSessionCookie(headers), "dev");

  headers.set("cookie", `${LEGACY_FILLX_SESSION_COOKIE}=legacy`);
  assert.equal(readFillxSessionCookie(headers), "legacy");
});

test("clearFillxSessionCookies expires all current and legacy session cookies", () => {
  const headers = new Headers();

  clearFillxSessionCookies(headers, { secure: true });

  const cookie = headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`${SECURE_FILLX_SESSION_COOKIE}=`));
  assert.match(cookie, new RegExp(`${DEV_FILLX_SESSION_COOKIE}=`));
  assert.match(cookie, new RegExp(`${LEGACY_FILLX_SESSION_COOKIE}=`));
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\//);
});
