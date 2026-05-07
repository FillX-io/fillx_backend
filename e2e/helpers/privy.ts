import { exportSPKI, generateKeyPair, SignJWT } from "jose";

export type TestPrivy = {
  appId: string;
  verificationKey: string;
  createAccessToken: (input: { privyUserId: string; sessionId?: string }) => Promise<string>;
};

export async function createTestPrivy(): Promise<TestPrivy> {
  const appId = "test-privy-app";
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const verificationKey = await exportSPKI(publicKey);

  return {
    appId,
    verificationKey,
    createAccessToken: async ({ privyUserId, sessionId }) =>
      new SignJWT({ sid: sessionId ?? "test-session" })
        .setProtectedHeader({ alg: "ES256" })
        .setIssuer("privy.io")
        .setAudience(appId)
        .setSubject(privyUserId)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey),
  };
}
