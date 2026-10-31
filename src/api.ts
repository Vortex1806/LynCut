import { env } from "./config/env.js";
import { buildServer } from "./http/server.js";
import { logger } from "./infra/logger.js";
import { prisma } from "./infra/prisma.js";
import { redis } from "./infra/redis.js";
import { registerShutdown } from "./shared/shutdown.js";

const app = buildServer();
const server = app.listen(env.PORT, "0.0.0.0");

registerShutdown(
  [
    {
      name: "http",
      run: () =>
        new Promise<void>((resolve, reject) => {
          server.closeIdleConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    },
    { name: "prisma", run: () => prisma.$disconnect() },
    { name: "redis", run: () => redis.quit() },
  ],
  {
    drainMs: env.SHUTDOWN_DRAIN_MS,
    timeoutMs: 10_000,
  },
);

server.on("listening", () => {
  logger.info({ port: env.PORT }, "Server started");
});

server.on("error", (error: unknown) => {
  logger.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
