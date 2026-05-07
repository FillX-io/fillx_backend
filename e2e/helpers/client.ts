import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "../../shared/src/contract.js";
import { CookieJar } from "./session.js";

export function createE2EClient(input: {
  baseUrl: string;
  cookieJar?: CookieJar;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
}) {
  const jar = input.cookieJar ?? new CookieJar();
  const link = new RPCLink({
    url: `${input.baseUrl}/rpc`,
    headers: async () => {
      const extra =
        typeof input.headers === "function" ? await input.headers() : input.headers ?? {};
      const cookie = jar.header();
      return cookie ? { ...extra, cookie } : extra;
    },
    fetch: async (request, init) => {
      const response = await fetch(request, init);
      jar.storeFrom(response.headers);
      return response;
    },
  });

  return {
    client: createORPCClient<ContractRouterClient<Contract>>(link),
    cookieJar: jar,
  };
}
