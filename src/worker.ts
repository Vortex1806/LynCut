import { createServer } from "node:http";

import { env } from "./config/env.js";
import { blockingRedis } from "./infra/blocking-redis.js";
import { logger } from "./infra/logger.js";
import { prisma } from "./infra/prisma.js";
import { redis } from "./infra/redis.js";
import {
  consumerName,
  getLastLoopAt,
  runConsumer,
} from "./modules/analytics/consumer.js";
import {
  flushVisitCounts,
  startFlusher,
  wakeFlusher,
} from "./modules/analytics/flusher.js";
import { isShuttingDown } from "./shared/lifecycle.js";
import { registerShutdown } from "./shared/shutdown.js";

const LOOP_STALE_MS = 20_000;
const consumerLoop = runConsumer();
const flusherLoop = startFlusher();

const health = createServer((req, res) => {
  const send = (status: number, body: Record<string, unknown>): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.url === "/healthz") {
    const idleMs = Date.now() - getLastLoopAt();
    if (idleMs > LOOP_STALE_MS) {
      return send(503, { status: "stalled", idleMs, consumerName });
    }

    return send(200, { status: "ok", idleMs, consumerName });
  }

  if (req.url === "/readyz") {
    if (isShuttingDown()) {
      return send(503, { status: "shutting_down" });
    }
    return send(200, { status: "ready" });
  }

  return send(404, { error: "NOT_FOUND" });
});

health.listen(env.WORKER_PORT, "0.0.0.0", () => {
  logger.info(
    { port: env.WORKER_PORT, consumerName },
    "Analytics worker started",
  );
});

registerShutdown(
  [
    {
      name: "health-server",
      run: () =>
        new Promise<void>((resolve, reject) => {
          health.closeIdleConnections();
          health.close((error) => (error ? reject(error) : resolve()));
        }),
    },

    {
      name: "consumer-loop",
      run: async () => {
        wakeFlusher();
        await Promise.allSettled([consumerLoop, flusherLoop]);
      },
    },

    {
      name: "final-flush",
      run: () => flushVisitCounts(),
    },

    { name: "prisma", run: () => prisma.$disconnect() },
    { name: "redis", run: () => redis.quit() },
    { name: "blocking-redis", run: () => blockingRedis.quit() },
  ],
  {
    drainMs: 0,
    timeoutMs: 20_000,
  },
);

void Promise.all([consumerLoop, flusherLoop]).catch(async (error: unknown) => {
  logger.fatal({ err: error }, "Analytics worker crashed");

  await Promise.allSettled([
    prisma.$disconnect(),
    redis.quit(),
    blockingRedis.quit(),
  ]);

  process.exit(1);
});
