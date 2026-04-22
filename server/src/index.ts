import "dotenv/config";
import { createServer } from "node:http";
import { RPCHandler } from "@orpc/server/node";
import { CORSPlugin } from "@orpc/server/plugins";
import { onError } from "@orpc/server";
import { router } from "./router.js";
import { handleRestApi } from "./rest-adapter.js";

const port = Number(process.env.PORT ?? 8000);

const handler = new RPCHandler(router, {
  plugins: [new CORSPlugin()],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

const server = createServer(async (req, res) => {
  // Health check (outside oRPC)
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // REST API compatibility
  if (req.url?.startsWith("/api/")) {
    return handleRestApi(req, res);
  }

  // oRPC
  const { matched } = await handler.handle(req, res, {
    prefix: "/rpc",
    context: {},
  });

  if (!matched) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(port, () => {
  console.log(`fillx_backend running on http://localhost:${port}`);
  console.log(`  RPC  → http://localhost:${port}/rpc`);
  console.log(`  Health → http://localhost:${port}/healthz`);
});
