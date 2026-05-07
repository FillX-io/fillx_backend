import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProfileLookupWallets } from "./profile-lookup.js";

const solanaAddress = "11111111111111111111111111111111";

test("normalizeProfileLookupWallets lowercases EVM addresses", () => {
  assert.deepEqual(
    normalizeProfileLookupWallets([
      "0x000000000000000000000000000000000000ABCD",
    ]),
    ["0x000000000000000000000000000000000000abcd"],
  );
});

test("normalizeProfileLookupWallets detects uppercase EVM prefixes", () => {
  assert.deepEqual(
    normalizeProfileLookupWallets([
      "0X000000000000000000000000000000000000ABCD",
    ]),
    ["0x000000000000000000000000000000000000abcd"],
  );
});

test("normalizeProfileLookupWallets preserves valid Solana base58 addresses", () => {
  assert.deepEqual(normalizeProfileLookupWallets([solanaAddress]), [
    solanaAddress,
  ]);
});

test("normalizeProfileLookupWallets drops invalid wallet lookup inputs", () => {
  assert.deepEqual(normalizeProfileLookupWallets(["not a wallet"]), []);
});
