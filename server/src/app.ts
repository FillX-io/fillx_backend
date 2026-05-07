import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RPCHandler } from "@orpc/server/node";
import {
  CORSPlugin,
  ResponseHeadersPlugin,
  type ResponseHeadersPluginContext,
} from "@orpc/server/plugins";
import { onError } from "@orpc/server";
import { router } from "./router.js";
import { handleRestApi } from "./rest-adapter.js";
import { createContext, type AppContext } from "./identity/context.js";

type AppServerContext = AppContext & ResponseHeadersPluginContext;

function parseCorsOrigins(): readonly string[] | undefined {
  const raw = process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN;
  if (!raw) return undefined;
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : undefined;
}

function resolveCorsOrigin(origin: string): readonly string[] {
  const configured = parseCorsOrigins();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return [];
  return origin ? [origin] : [];
}

export function createAppServer() {
  const handler = new RPCHandler(router, {
    plugins: [
      new CORSPlugin<AppServerContext>({
        credentials: true,
        origin: (origin) => resolveCorsOrigin(origin),
      }),
      new ResponseHeadersPlugin<AppServerContext>(),
    ],
    interceptors: [
      onError((error) => {
        console.error(error);
      }),
    ],
  });

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url?.startsWith("/api/")) {
      return handleRestApi(req, res);
    }

    const { matched } = await handler.handle(req, res, {
      prefix: "/rpc",
      context: await createContext(req),
    });

    if (!matched) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
}
