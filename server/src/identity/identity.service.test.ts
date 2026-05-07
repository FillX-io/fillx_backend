import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityService, type FillxUser } from "./identity.service.js";

function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  const now = new Date("2026-05-07T00:00:00.000Z");
  return {
    id: input.id ?? "user-1",
    username: input.username ?? "trader_0001",
    username_status: input.username_status ?? "generated",
    display_name: input.display_name ?? null,
    avatar_url: input.avatar_url ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
  };
}

test("getCurrentUser returns a guest response without creating a user for anonymous auth", async () => {
  let createCount = 0;
  const service = createIdentityService({
    users: {
      findById: async () => undefined,
      findByUsername: async () => undefined,
      createGeneratedUser: async () => {
        createCount += 1;
        return makeUser();
      },
      updateDisplayName: async () => {
        throw new Error("should not update user");
      },
    },
  });

  const result = await service.getCurrentUser({ auth: { type: "anonymous" } });

  assert.deepEqual(result, { user: null, guest: { isGuest: true } });
  assert.equal(createCount, 0);
});

test("getCurrentUser returns an existing FillX session user", async () => {
  const existing = makeUser({ id: "user-session", username: "alice" });
  const service = createIdentityService({
    users: {
      findById: async (id) => (id === existing.id ? existing : undefined),
      findByUsername: async () => undefined,
      createGeneratedUser: async () => {
        throw new Error("should not create user");
      },
      updateDisplayName: async () => {
        throw new Error("should not update user");
      },
    },
  });

  const result = await service.getCurrentUser({
    auth: { type: "fillx", userId: "user-session" },
  });

  assert.deepEqual(result, { user: existing, guest: null });
});

test("getCurrentUser returns an existing Privy-linked user", async () => {
  const existing = makeUser({ id: "user-existing", username: "alice" });
  const service = createIdentityService({
    users: {
      findById: async (id) => (id === existing.id ? existing : undefined),
      findByUsername: async () => undefined,
      createGeneratedUser: async () => {
        throw new Error("should not create user");
      },
      updateDisplayName: async () => {
        throw new Error("should not update user");
      },
    },
    authIdentities: {
      findByProviderUserId: async () => ({ user_id: existing.id }),
      linkPrivyIdentity: async () => {
        throw new Error("should not link identity");
      },
    },
  });

  const result = await service.getCurrentUser({
    auth: { type: "privy", privyUserId: "privy-user-1" },
  });

  assert.deepEqual(result, { user: existing, guest: null });
});

test("getCurrentUser creates a generated user only for verified Privy auth", async () => {
  const linked: Array<{ userId: string; privyUserId: string }> = [];
  const created = makeUser({ id: "user-created", username: "trader_002a" });
  const service = createIdentityService(
    {
      users: {
        findById: async () => undefined,
        findByUsername: async () => undefined,
        createGeneratedUser: async (username) => ({
          ...created,
          username,
        }),
        updateDisplayName: async () => {
          throw new Error("should not update user");
        },
      },
      authIdentities: {
        findByProviderUserId: async () => undefined,
        linkPrivyIdentity: async (input) => {
          linked.push(input);
          return {};
        },
      },
    },
    { randomInt: () => 42 },
  );

  const result = await service.getCurrentUser({
    auth: { type: "privy", privyUserId: "privy-user-2" },
  });

  assert.equal(result.user?.username, "trader_002a");
  assert.equal(result.guest, null);
  assert.deepEqual(linked, [
    { userId: "user-created", privyUserId: "privy-user-2" },
  ]);
});
