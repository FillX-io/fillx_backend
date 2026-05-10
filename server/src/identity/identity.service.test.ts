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

function makeProfileUpdateService(
  initialUser: FillxUser = makeUser({ display_name: "FillX_Trader" }),
  users: FillxUser[] = [],
) {
  let stored = initialUser;
  const updates: Array<{
    userId: string;
    displayName?: string | null;
    nationality?: string | null;
  }> = [];

  const usersRepo = {
    findById: async (id: string) => (id === stored.id ? stored : undefined),
    findByDisplayNameCaseInsensitive: async (displayName: string) => {
      const requested = displayName.toLowerCase();
      return [stored, ...users].find(
        (user) => user.display_name?.toLowerCase() === requested,
      );
    },
    createUser: async () => {
      throw new Error("should not create user");
    },
    updateProfile: async (input: {
      userId: string;
      displayName?: string | null;
      nationality?: string | null;
    }) => {
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
  };

  const service = createIdentityService({
    users: usersRepo,
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
    displayName: " FillX_Trader ",
  });

  assert.equal(result.display_name, "FillX_Trader");
  assert.deepEqual(updates, [
    {
      userId: "user-1",
      displayName: "FillX_Trader",
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
    makeUser({ display_name: "FillX_Trader", nationality: "JP" }),
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
    makeUser({ display_name: "Existing_User", nationality: "BR" }),
  );

  const displayNameResult = await service.updateProfile({
    userId: "user-1",
    displayName: "  New_Display  ",
  });
  const nationalityResult = await service.updateProfile({
    userId: "user-1",
    nationality: "ca",
  });

  assert.equal(displayNameResult.display_name, "New_Display");
  assert.equal(displayNameResult.nationality, "BR");
  assert.equal(nationalityResult.display_name, "New_Display");
  assert.equal(nationalityResult.nationality, "CA");
});

test("updateProfile rejects null display name before writing", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ display_name: "Existing_User" }),
  );

  await assert.rejects(
    service.updateProfile({
      userId: "user-1",
      displayName: null,
    }),
    /USERNAME_REQUIRED/,
  );

  assert.deepEqual(updates, []);
});

const invalidDisplayNameCases: Array<{
  name: string;
  displayName: string;
  error: RegExp;
}> = [
  { name: "blank", displayName: "   ", error: /USERNAME_REQUIRED/ },
  { name: "too short", displayName: "ab", error: /INVALID_DISPLAY_NAME/ },
  {
    name: "too long",
    displayName: "abcdefghijklmnopqrstuvwxyz",
    error: /INVALID_DISPLAY_NAME/,
  },
  {
    name: "spaces",
    displayName: "FillX Trader",
    error: /INVALID_DISPLAY_NAME/,
  },
  { name: "hyphen", displayName: "FillX-Trader", error: /INVALID_DISPLAY_NAME/ },
  { name: "dot", displayName: "FillX.Trader", error: /INVALID_DISPLAY_NAME/ },
  { name: "non-ASCII", displayName: "FillX_ß", error: /INVALID_DISPLAY_NAME/ },
  { name: "symbols", displayName: "FillX!", error: /INVALID_DISPLAY_NAME/ },
];

for (const invalidCase of invalidDisplayNameCases) {
  test(`updateProfile rejects ${invalidCase.name} display name`, async () => {
    const { service, updates } = makeProfileUpdateService();

    await assert.rejects(
      service.updateProfile({
        userId: "user-1",
        displayName: invalidCase.displayName,
      }),
      invalidCase.error,
    );

    assert.deepEqual(updates, []);
  });
}

test("updateProfile rejects case-insensitive display name duplicates", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ id: "user-1", display_name: "Current_User" }),
    [makeUser({ id: "user-2", display_name: "Taken_Name" })],
  );

  await assert.rejects(
    service.updateProfile({
      userId: "user-1",
      displayName: "taken_name",
    }),
    /DISPLAY_NAME_TAKEN/,
  );

  assert.deepEqual(updates, []);
});

test("updateProfile maps display name unique index violations to taken", async () => {
  const uniqueViolation = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "fillx_users_display_name_lower_unique_idx",
  });
  const usersRepo = {
    findById: async (id: string) =>
      id === "user-1" ? makeUser({ id, display_name: "Current_User" }) : undefined,
    findByDisplayNameCaseInsensitive: async () => undefined,
    createUser: async () => {
      throw new Error("should not create user");
    },
    updateProfile: async () => {
      throw uniqueViolation;
    },
  };
  const service = createIdentityService({ users: usersRepo });

  await assert.rejects(
    service.updateProfile({
      userId: "user-1",
      displayName: "New_Display",
    }),
    /DISPLAY_NAME_TAKEN/,
  );
});

test("updateProfile allows the same user to change only display name casing", async () => {
  const { service, updates } = makeProfileUpdateService(
    makeUser({ id: "user-1", display_name: "FillX_Trader" }),
  );

  const result = await service.updateProfile({
    userId: "user-1",
    displayName: "fillx_trader",
  });

  assert.equal(result.display_name, "fillx_trader");
  assert.deepEqual(updates, [{ userId: "user-1", displayName: "fillx_trader" }]);
});

test("updateProfile rejects nationality-only update when stored display name is null or invalid", async () => {
  const nullDisplayName = makeProfileUpdateService(makeUser({ display_name: null }));
  const invalidDisplayName = makeProfileUpdateService(
    makeUser({ display_name: "Invalid User" }),
  );

  await assert.rejects(
    nullDisplayName.service.updateProfile({
      userId: "user-1",
      nationality: "us",
    }),
    /USERNAME_REQUIRED/,
  );
  await assert.rejects(
    invalidDisplayName.service.updateProfile({
      userId: "user-1",
      nationality: "us",
    }),
    /INVALID_DISPLAY_NAME/,
  );

  assert.deepEqual(nullDisplayName.updates, []);
  assert.deepEqual(invalidDisplayName.updates, []);
});
