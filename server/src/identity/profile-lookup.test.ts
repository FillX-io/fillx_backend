import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { normalizeProfileLookupWallets } from "./profile-lookup.js";

const solanaSecret = Uint8Array.from(
  Array.from({ length: 32 }, (_, index) => index + 1),
);
const solanaKeypair = nacl.sign.keyPair.fromSeed(solanaSecret);
const solanaAddress = bs58.encode(solanaKeypair.publicKey);

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
  assert.notEqual(solanaAddress, solanaAddress.toLowerCase());
  assert.deepEqual(normalizeProfileLookupWallets([solanaAddress]), [
    solanaAddress,
  ]);
});

test("normalizeProfileLookupWallets drops invalid wallet lookup inputs", () => {
  assert.deepEqual(normalizeProfileLookupWallets(["not a wallet"]), []);
});
