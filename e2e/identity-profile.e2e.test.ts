import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { getDb } from "../server/src/db/client.js";
import { activeWalletHeaders, evmWalletKey } from "./helpers/avatar.js";
import { setupE2E } from "./helpers/harness.js";
import {
  evmWallet,
  secondEvmWallet,
  signEvmMessage,
  signSecondEvmMessage,
} from "./helpers/wallets.js";

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

async function addSecondaryEvmWalletSession(input: {
  userId: string;
  primaryWalletAddress: string;
  secondaryWalletAddress: string;
}): Promise<void> {
  const db = getDb();
  const primaryWalletAddress = input.primaryWalletAddress.toLowerCase();
  const secondaryWalletAddress = input.secondaryWalletAddress.toLowerCase();
  const familyResult = await db.execute(
    sql<{ family_id: string }>`
      select family_id
      from fillx_wallet_sessions
      where profile_user_id = ${input.userId}
        and wallet_key = ${evmWalletKey(primaryWalletAddress)}
      limit 1
    `,
  );
  const familyRows = Array.isArray(familyResult)
    ? familyResult
    : familyResult.rows;
  const familyId = familyRows[0]?.family_id;
  assert.ok(familyId, "expected verified primary wallet session family");

  await db.execute(sql`
    insert into user_wallets (
      user_id,
      chain_type,
      wallet_address,
      is_primary,
      verified_at
    )
    values (
      ${input.userId},
      'evm',
      ${secondaryWalletAddress},
      false,
      now()
    )
  `);

  await db.execute(sql`
    insert into fillx_wallet_sessions (
      family_id,
      wallet_key,
      wallet_address,
      wallet_namespace,
      signature_scheme,
      last_signed_chain,
      signed_at,
      profile_user_id,
      last_used_at,
      expires_at
    )
    values (
      ${familyId},
      ${evmWalletKey(secondaryWalletAddress)},
      ${secondaryWalletAddress},
      'evm',
      'eip191',
      '1',
      now(),
      ${input.userId},
      now(),
      now() + interval '1 day'
    )
  `);
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
    displayName: "FillX_Trader",
    nationality: "US",
  });

  const { client: publicClient } = createClient({ baseUrl });
  const profile = await publicClient.profile.getByWallets({
    walletAddresses: [evmWallet.address],
  });
  assert.equal(profile.profiles.length, 1);
  assert.equal(profile.profiles[0].displayName, "FillX_Trader");
  assert.equal(profile.profiles[0].nationality, "US");
  assert.equal(
    profile.profiles[0].walletAddress,
    evmWallet.address.toLowerCase(),
  );
  assertNoRemovedIdentityFields(profile.profiles[0]);
});

test("duplicate display name update is rejected case-insensitively", async (t) => {
  const { baseUrl, client, cookieJar, createClient } = await setupE2E(t);
  await verifyEvmWalletProfile(client);

  const { client: firstActiveWalletClient } = createClient({
    baseUrl,
    cookieJar,
    headers: activeWalletHeaders(evmWalletKey(evmWallet.address)),
  });
  await firstActiveWalletClient.identity.updateDisplayName({
    displayName: "Taken_Name",
  });

  const { client: secondClient, cookieJar: secondCookieJar } = createClient({
    baseUrl,
  });
  const challenge = await secondClient.identity.requestWalletSessionChallenge({
    walletAddress: secondEvmWallet.address,
    chainType: "evm",
    chainId: 1,
  });
  await secondClient.identity.verifyWalletSession({
    challengeId: challenge.challengeId,
    signature: await signSecondEvmMessage(challenge.message),
  });

  const { client: secondActiveWalletClient } = createClient({
    baseUrl,
    cookieJar: secondCookieJar,
    headers: activeWalletHeaders(evmWalletKey(secondEvmWallet.address)),
  });
  await assert.rejects(
    secondActiveWalletClient.identity.updateDisplayName({
      displayName: "taken_name",
    }),
    (error) => {
      assert.equal((error as { code?: unknown }).code, "DISPLAY_NAME_TAKEN");
      assert.equal((error as { status?: unknown }).status, 409);
      return true;
    },
  );
});

test("public wallet lookup by non-primary verified wallet returns primary wallet binding", async (t) => {
  const { baseUrl, client, createClient } = await setupE2E(t);
  const current = await verifyEvmWalletProfile(client);
  assert.equal(current.state, "authenticated");
  assert.ok(current.user);
  await addSecondaryEvmWalletSession({
    userId: current.user.id,
    primaryWalletAddress: evmWallet.address,
    secondaryWalletAddress: secondEvmWallet.address,
  });

  const { client: publicClient } = createClient({ baseUrl });
  const profile = await publicClient.profile.getByWallets({
    walletAddresses: [secondEvmWallet.address],
  });

  assert.equal(profile.profiles.length, 1);
  assert.equal(
    profile.profiles[0].walletAddress,
    secondEvmWallet.address.toLowerCase(),
  );
  assert.equal(profile.profiles[0].primaryWallet.chainType, "evm");
  assert.equal(
    profile.profiles[0].primaryWallet.walletAddress,
    evmWallet.address.toLowerCase(),
  );
  assert.equal(
    profile.profiles[0].primaryWallet.walletKey,
    evmWalletKey(evmWallet.address),
  );
  assertNoRemovedIdentityFields(profile.profiles[0]);
});

test("authenticated current-user on non-primary wallet session serializes stored primary wallet", async (t) => {
  const { baseUrl, client, cookieJar, createClient } = await setupE2E(t);
  const current = await verifyEvmWalletProfile(client);
  assert.equal(current.state, "authenticated");
  assert.ok(current.user);
  await addSecondaryEvmWalletSession({
    userId: current.user.id,
    primaryWalletAddress: evmWallet.address,
    secondaryWalletAddress: secondEvmWallet.address,
  });

  const { client: secondaryWalletClient } = createClient({
    baseUrl,
    cookieJar,
    headers: activeWalletHeaders(evmWalletKey(secondEvmWallet.address)),
  });
  const resumed = await secondaryWalletClient.identity.getCurrentUser();

  assert.equal(resumed.state, "authenticated");
  assert.equal(resumed.walletKey, evmWalletKey(secondEvmWallet.address));
  assert.equal(resumed.user?.id, current.user.id);
  assert.equal(resumed.user?.primaryWallet?.chainType, "evm");
  assert.equal(
    resumed.user?.primaryWallet?.walletAddress,
    evmWallet.address.toLowerCase(),
  );
  assert.equal(
    resumed.user?.primaryWallet?.walletKey,
    evmWalletKey(evmWallet.address),
  );
});
