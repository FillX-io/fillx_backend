import bs58 from "bs58";
import nacl from "tweetnacl";
import { privateKeyToAccount } from "viem/accounts";

const EVM_PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SECOND_EVM_PRIVATE_KEY =
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

export const evmWallet = privateKeyToAccount(EVM_PRIVATE_KEY);
export const secondEvmWallet = privateKeyToAccount(SECOND_EVM_PRIVATE_KEY);

const solanaSeed = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
export const solanaKeypair = nacl.sign.keyPair.fromSeed(solanaSeed);
export const solanaWalletAddress = bs58.encode(solanaKeypair.publicKey);

export async function signEvmMessage(message: string): Promise<string> {
  return evmWallet.signMessage({ message });
}

export async function signSecondEvmMessage(message: string): Promise<string> {
  return secondEvmWallet.signMessage({ message });
}

export function signSolanaMessage(message: string): string {
  return bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), solanaKeypair.secretKey),
  );
}
