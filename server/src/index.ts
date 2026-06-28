import { createServer } from "node:http";
import { createApp } from "./app.js";

const port = Number(process.env.AGENT_NEXUS_PORT ?? process.env.PORT ?? 4173);
const host = process.env.AGENT_NEXUS_HOST ?? "127.0.0.1";
const app = createApp();
const server = createServer(app);

server.listen(port, host, () => {
  const address = server.address();
  const renderedAddress = typeof address === "object" && address ? `${address.address}:${address.port}` : String(address);
  console.log(`Agent Nexus server listening on http://${renderedAddress}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
