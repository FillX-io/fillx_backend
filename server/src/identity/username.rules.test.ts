import assert from "node:assert/strict";
import test from "node:test";
import {
  generateUsernameCandidate,
  validateUsername,
} from "./username.rules.js";

test("validateUsername accepts lowercase usernames that start with a letter", () => {
  assert.deepEqual(validateUsername("trader_123"), {
    ok: true,
    username: "trader_123",
  });
});

test("validateUsername rejects uppercase names", () => {
  assert.deepEqual(validateUsername("Trader"), {
    ok: false,
    code: "INVALID_USERNAME",
    reason: "Username must be lowercase.",
  });
});

test("validateUsername rejects reserved names", () => {
  assert.deepEqual(validateUsername("admin"), {
    ok: false,
    code: "USERNAME_RESERVED",
    reason: "This username is reserved.",
  });
});

test("generateUsernameCandidate creates stable trader handles from random input", () => {
  assert.equal(generateUsernameCandidate(() => 255), "trader_00ff");
});
