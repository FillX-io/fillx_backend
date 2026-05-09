import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { getDb } from "../server/src/db/client.js";
import { activeWalletHeaders, evmWalletKey } from "./helpers/avatar.js";
import { setupE2E } from "./helpers/harness.js";
import { evmWallet, signEvmMessage } from "./helpers/wallets.js";

if (!process.env.E2E_DATABASE_ADMIN_URL) {
  throw new Error(
    "E2E_DATABASE_ADMIN_URL is required for FillX identity E2E tests",
  );
}

async function countFillxUsers(): Promise<number> {
  const result = await getDb().execute(
    sql<{ count: string }>`select count(*)::text as count from fillx_users`,
  );
  const rows = Array.isArray(result) ? result : result.rows;
  const count = rows[0]?.count;
  assert.ok(count, "expected fillx_users count row");
  return Number(count);
}

function assertFillxCookie(cookie: string | undefined): void {
  assert.ok(cookie, "expected Set-Cookie header");
  assert.match(cookie, /(?:__Host-fillx_sid|fillx_sid)=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
}

function assertNoRemovedIdentityFields(value: unknown): void {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const record = value as Record<string, unknown>;
  for (const key of [
    "user" + "name",
    "user" + "nameStatus",
    "hasClaimed" + "User" + "name",
  ]) {
    assert.equal(key in record, false);
  }
}

async function verifyEvmWalletProfile(
  client: Awaited<ReturnType<typeof setupE2E>>["client"],
) {
  const challenge = await client.identity.requestWalletSessionChallenge({
    walletAddress: evmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  return client.identity.verifyWalletSession({
    challengeId: challenge.challengeId,
    signature: await signEvmMessage(challenge.message),
  });
}

test("guest current-user is non-persistent", async (t) => {
  const { client } = await setupE2E(t);

  assert.deepEqual(await client.identity.getCurrentUser(), {
    state: "no_active_wallet",
    user: null,
    guest: { isGuest: true },
  });
  assert.equal(await countFillxUsers(), 0);
});

test("verified EVM wallet creates a FillX profile without removed identity fields", async (t) => {
  const { baseUrl, client, cookieJar, createClient } = await setupE2E(t);

  const current = await verifyEvmWalletProfile(client);

  assert.equal(current.state, "authenticated");
  assert.equal(current.walletKey, evmWalletKey(evmWallet.address));
  assert.ok(current.user);
  assert.equal(current.user.displayName, null);
  assert.equal(current.user.nationality, null);
  assert.equal(current.user.primaryWallet?.chainType, "evm");
  assert.equal(
    current.user.primaryWallet?.walletAddress,
    evmWallet.address.toLowerCase(),
  );
  assert.equal(
    current.user.primaryWallet?.walletKey,
    evmWalletKey(evmWallet.address),
  );
  assertNoRemovedIdentityFields(current.user);
  assertNoRemovedIdentityFields(current);
  assertFillxCookie(cookieJar.lastSetCookieHeader());

  const { client: activeWalletClient } = createClient({
    baseUrl,
    cookieJar,
    headers: activeWalletHeaders(evmWalletKey(evmWallet.address)),
  });
  const resumed = await activeWalletClient.identity.getCurrentUser();
  assert.equal(resumed.state, "authenticated");
  assert.equal(resumed.walletKey, evmWalletKey(evmWallet.address));
  assert.equal(resumed.user?.id, current.user.id);
});

test("public wallet lookup returns display metadata and no removed identity fields", async (t) => {
  const { baseUrl, client, cookieJar, createClient } = await setupE2E(t);
  const current = await verifyEvmWalletProfile(client);
  assert.equal(current.state, "authenticated");

  const { client: activeWalletClient } = createClient({
    baseUrl,
    cookieJar,
    headers: activeWalletHeaders(evmWalletKey(evmWallet.address)),
  });
  await activeWalletClient.identity.updateDisplayName({
    displayName: "FillX Trader",
    nationality: "US",
  });

  const profile = await client.profile.getByWallets({
    walletAddresses: [evmWallet.address],
  });
  assert.equal(profile.profiles.length, 1);
  assert.equal(profile.profiles[0].displayName, "FillX Trader");
  assert.equal(profile.profiles[0].nationality, "US");
  assert.equal(
    profile.profiles[0].walletAddress,
    evmWallet.address.toLowerCase(),
  );
  assertNoRemovedIdentityFields(profile.profiles[0]);
});
