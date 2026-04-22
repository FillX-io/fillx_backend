import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createORPCReactQueryUtils } from "@orpc/react-query";
import type { ContractRouterClient } from "@orpc/contract";
import type { Contract } from "@fillx/shared";

/**
 * Create a type-safe oRPC client.
 *
 * Usage (vanilla):
 *   const client = createClient("http://localhost:8000");
 *   const data = await client.earthquakes();
 */
export function createClient(baseUrl: string) {
  const link = new RPCLink({ url: `${baseUrl}/rpc` });
  return createORPCClient<ContractRouterClient<Contract>>(link);
}

/**
 * Create React Query utils with oRPC integration.
 *
 * Usage (React):
 *   const { orpc } = createQueryUtils("http://localhost:8000");
 *
 *   // inside component
 *   const { data } = orpc.earthquakes.useQuery();
 */
export function createQueryUtils(baseUrl: string) {
  const client = createClient(baseUrl);
  const orpc = createORPCReactQueryUtils(client);
  return { client, orpc };
}

export type { Contract } from "@fillx/shared";
export { EarthquakeFeature, CoinMarket, CoingeckoQuery } from "@fillx/shared";
