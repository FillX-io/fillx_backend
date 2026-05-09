import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityService, type FillxUser } from "./identity.service.js";

function makeUser(input: Partial<FillxUser> = {}): FillxUser {
  const now = new Date("2026-05-07T00:00:00.000Z");
  return {
    id: input.id === undefined ? "user-1" : input.id,
    display_name: input.display_name === undefined ? null : input.display_name,
    avatar_key: input.avatar_key === undefined ? null : input.avatar_key,
    avatar_updated_at:
      input.avatar_updated_at === undefined ? null : input.avatar_updated_at,
    nationality: input.nationality === undefined ? null : input.nationality,
    created_at: input.created_at === undefined ? now : input.created_at,
    updated_at: input.updated_at === undefined ? now : input.updated_at,
  };
}

test("getCurrentUser returns a guest response without creating a user for anonymous auth", async () => {
  let createCount = 0;
  const service = createIdentityService({
    users: {
      findById: async () => undefined,
      createUser: async () => {
        createCount += 1;
        return makeUser();
      },
      updateProfile: async () => {
        throw new Error("should not update user");
      },
    },
  });

  const result = await service.getCurrentUser({ auth: { type: "anonymous" } });

  assert.deepEqual(result, { user: null, guest: { isGuest: true } });
  assert.equal(createCount, 0);
});

test("getCurrentUser returns an existing FillX session user", async () => {
  const existing = makeUser({ id: "user-session" });
  const service = createIdentityService({
    users: {
      findById: async (id) => (id === existing.id ? existing : undefined),
      createUser: async () => {
        throw new Error("should not create user");
      },
      updateProfile: async () => {
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
  const existing = makeUser({ id: "user-existing" });
  const service = createIdentityService({
    users: {
      findById: async (id) => (id === existing.id ? existing : undefined),
      createUser: async () => {
        throw new Error("should not create user");
      },
      updateProfile: async () => {
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

test("getCurrentUser creates a user only for verified Privy auth", async () => {
  const linked: Array<{ userId: string; privyUserId: string }> = [];
  const created = makeUser({ id: "user-created" });
  const service = createIdentityService({
    users: {
      findById: async () => undefined,
      createUser: async () => created,
      updateProfile: async () => {
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
  });

  const result = await service.getCurrentUser({
    auth: { type: "privy", privyUserId: "privy-user-2" },
  });

  assert.equal(result.user?.id, "user-created");
  assert.equal(result.guest, null);
  assert.deepEqual(linked, [
    { userId: "user-created", privyUserId: "privy-user-2" },
  ]);
});

test("createUserFromWalletProof creates a profile without generated identity data", async () => {
  const created = makeUser({ id: "wallet-user" });
  const calls: string[] = [];
  const service = createIdentityService({
    users: {
      findById: async () => undefined,
      createUser: async () => {
        calls.push("createUser");
        return created;
      },
      updateProfile: async () => {
        throw new Error("should not update user");
      },
    },
  });

  const result = await service.createUserFromWalletProof();

  assert.equal(result.id, "wallet-user");
  assert.deepEqual(calls, ["createUser"]);
});

function makeProfileUpdateService(initialUser: FillxUser = makeUser()) {
  let stored = initialUser;
  const updates: Array<{
    userId: string;
    displayName?: string | null;
    nationality?: string | null;
  }> = [];

  const service = createIdentityService({
    users: {
      findById: async (id) => (id === stored.id ? stored : undefined),
      createUser: async () => {
        throw new Error("should not create user");
      },
      updateProfile: async (input) => {
        updates.push(input);
        stored = {
          ...stored,
          display_name:
            input.displayName === undefined ? stored.display_name : input.displayName,
          nationality:
            input.nationality === undefined ? stored.nationality : input.nationality,
          updated_at: new Date("2026-05-07T00:01:00.000Z"),
        };
        return stored;
      },
    },
  });

  return {
    service,
    updates,
    getStored: () => stored,
  };
}

test("updateProfile trims and updates display name without avatar fields", async () => {
  const { service, updates } = makeProfileUpdateService();

  const result = await service.updateProfile({
    userId: "user-1",
    displayName: " FillX Trader ",
  });

  assert.equal(result.display_name, "FillX Trader");
  assert.deepEqual(updates, [
    {
      userId: "user-1",
      displayName: "FillX Trader",
    },
  ]);
});

test("updateProfile normalizes lowercase nationality to uppercase", async () => {
  const { service, updates } = makeProfileUpdateService();

  const result = await service.updateProfile({
    userId: "user-1",
    nationality: "us",
  });

  assert.equal(result.nationality, "US");
  assert.deepEqual(updates, [{ userId: "user-1", nationality: "US" }]);
});

test("updateProfile accepts uppercase nationality unchanged", async () => {
  const { service, updates } = makeProfileUpdateService();

  const result = await service.updateProfile({
    userId: "user-1",
    nationality: "NG",
  });

  assert.equal(result.nationality, "NG");
  assert.deepEqual(updates, [{ userId: "user-1", nationality: "NG" }]);
});

test("updateProfile clears nationality with empty string or null", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ nationality: "JP" }),
  );

  const emptyResult = await service.updateProfile({
    userId: "user-1",
    nationality: "   ",
  });
  const nullResult = await service.updateProfile({
    userId: "user-1",
    nationality: null,
  });

  assert.equal(emptyResult.nationality, null);
  assert.equal(nullResult.nationality, null);
  assert.deepEqual(updates, [
    { userId: "user-1", nationality: null },
    { userId: "user-1", nationality: null },
  ]);
});

test("updateProfile rejects invalid nationality before writing", async () => {
  const { service, updates } = makeProfileUpdateService();

  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "usa" }),
    /INVALID_NATIONALITY/,
  );
  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "1!" }),
    /INVALID_NATIONALITY/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile rejects non-ASCII nationality before writing", async () => {
  const { service, updates } = makeProfileUpdateService();

  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "ß" }),
    /INVALID_NATIONALITY/,
  );
  await assert.rejects(
    service.updateProfile({ userId: "user-1", nationality: "ﬀ" }),
    /INVALID_NATIONALITY/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile preserves omitted fields and trims display name", async () => {
  const { service } = makeProfileUpdateService(
    makeUser({ display_name: "Existing", nationality: "BR" }),
  );

  const displayNameResult = await service.updateProfile({
    userId: "user-1",
    displayName: "  New Display  ",
  });
  const nationalityResult = await service.updateProfile({
    userId: "user-1",
    nationality: "ca",
  });

  assert.equal(displayNameResult.display_name, "New Display");
  assert.equal(displayNameResult.nationality, "BR");
  assert.equal(nationalityResult.display_name, "New Display");
  assert.equal(nationalityResult.nationality, "CA");
});

test("updateProfile clears display name with null", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing" }),
  );

  const result = await service.updateProfile({
    userId: "user-1",
    displayName: null,
  });

  assert.equal(result.display_name, null);
  assert.deepEqual(updates, [{ userId: "user-1", displayName: null }]);
});
