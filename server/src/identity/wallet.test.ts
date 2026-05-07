import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { privateKeyToAccount } from "viem/accounts";
import { normalizeWalletAddress, verifyWalletSignature } from "./wallet.js";

const evmPrivateKey =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const evmAccount = privateKeyToAccount(evmPrivateKey);

const solanaSecret = Uint8Array.from(
  Array.from({ length: 32 }, (_, index) => index + 1),
);
const solanaKeypair = nacl.sign.keyPair.fromSeed(solanaSecret);
const solanaAddress = bs58.encode(solanaKeypair.publicKey);

test("verifyWalletSignature accepts valid EVM personal signatures", async () => {
  const message = "FillX test message";
  const signature = await evmAccount.signMessage({ message });

  assert.equal(
    await verifyWalletSignature({
      chainType: "evm",
      walletAddress: evmAccount.address,
      message,
      signature,
    }),
    true,
  );
});

test("verifyWalletSignature rejects EVM signatures for a different message", async () => {
  const signature = await evmAccount.signMessage({ message: "message a" });

  assert.equal(
    await verifyWalletSignature({
      chainType: "evm",
      walletAddress: evmAccount.address,
      message: "message b",
      signature,
    }),
    false,
  );
});

test("verifyWalletSignature accepts valid Solana signatures", async () => {
  const message = "FillX Solana test message";
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), solanaKeypair.secretKey),
  );

  assert.equal(
    await verifyWalletSignature({
      chainType: "solana",
      walletAddress: solanaAddress,
      message,
      signature,
    }),
    true,
  );
});

test("normalizeWalletAddress preserves Solana base58 case", () => {
  assert.equal(normalizeWalletAddress("solana", solanaAddress), solanaAddress);
});
