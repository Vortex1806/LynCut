import { env } from "./config/env.js";
import { buildServer } from "./http/server.js";
import { blockingRedis } from "./infra/blocking-redis.js";
import { prisma } from "./infra/prisma.js";
import { redis } from "./infra/redis.js";
import { registerShutdown } from "./shared/shutdown.js";

const app = buildServer();

async function start() {
  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

registerShutdown(
  [
    {
      name: "fastify",
      run: () => app.close(),
    },
    {
      name: "prisma",
      run: () => prisma.$disconnect(),
    },
    {
      name: "redis",
      run: () => redis.quit(),
    },
    {
      name: "blocking-redis",
      run: () => blockingRedis.quit(),
    },
  ],
  {
    drainMs: env.SHUTDOWN_DRAIN_MS,
    timeoutMs: 10_000,
  },
);

void start();
