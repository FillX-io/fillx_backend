import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createAppServer } from "../../server/src/app.js";
import { closeDb, resetDbForTests } from "../../server/src/db/client.js";

export type TestServer = {
  server: Server;
  baseUrl: string;
  stop: () => Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  resetDbForTests();
  const server = createAppServer();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      cleanup();
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } finally {
        await closeDb();
      }
    },
  };
}
