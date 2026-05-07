import bs58 from "bs58";
import nacl from "tweetnacl";
import { getAddress, verifyMessage, type Hex } from "viem";
import type { ChainType } from "../db/schema.js";

export function normalizeWalletAddress(
  chainType: ChainType,
  walletAddress: string,
): string {
  if (chainType === "evm") {
    return getAddress(walletAddress).toLowerCase();
  }

  if (chainType === "solana") {
    const bytes = bs58.decode(walletAddress);
    if (bytes.length !== 32) {
      throw new Error("Invalid Solana public key length");
    }
    return bs58.encode(bytes);
  }

  const exhaustive: never = chainType;
  throw new Error(`Unsupported chain type: ${exhaustive}`);
}

async function verifyEvmSignature(input: {
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  try {
    return await verifyMessage({
      address: getAddress(input.walletAddress),
      message: input.message,
      signature: input.signature as Hex,
    });
  } catch {
    return false;
  }
}

async function verifySolanaSignature(input: {
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  try {
    const publicKey = bs58.decode(input.walletAddress);
    const signature = bs58.decode(input.signature);
    const message = new TextEncoder().encode(input.message);
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

export async function verifyWalletSignature(input: {
  chainType: ChainType;
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const walletAddress = normalizeWalletAddress(
    input.chainType,
    input.walletAddress,
  );

  if (input.chainType === "evm") {
    return verifyEvmSignature({
      walletAddress,
      message: input.message,
      signature: input.signature,
    });
  }

  if (input.chainType === "solana") {
    return verifySolanaSignature({
      walletAddress,
      message: input.message,
      signature: input.signature,
    });
  }

  const exhaustive: never = input.chainType;
  throw new Error(`Unsupported chain type: ${exhaustive}`);
}
