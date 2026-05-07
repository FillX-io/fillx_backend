import "dotenv/config";
import { createAppServer } from "./app.js";

const port = Number(process.env.PORT ?? 8000);
const server = createAppServer();

server.listen(port, () => {
  console.log(`fillx_backend running on http://localhost:${port}`);
  console.log(`  RPC  -> http://localhost:${port}/rpc`);
  console.log(`  Health -> http://localhost:${port}/healthz`);
});
