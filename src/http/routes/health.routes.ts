import type { FastifyPluginAsync } from "fastify";
import { isShuttingDown } from "../../shared/lifecycle.js";
import { withTimeout } from "../../shared/with-timeout.js";
import { prisma } from "../../infra/prisma.js";
import { redis } from "../../infra/redis.js";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async () => {
    return { status: "ok" };
  });

  app.get("/readyz", async (request, reply) => {
    if (isShuttingDown()) {
      return reply.code(503).send({ status: "not_ready" });
    }
    const timeoutMs = 2_000;

    const [postgresResult, redisResult] = await Promise.allSettled([
      withTimeout(prisma.$queryRaw`SELECT 1`, timeoutMs, "postgres"),
      withTimeout(redis.ping(), timeoutMs, "redis"),
    ]);

    const postgresReady = postgresResult.status === "fulfilled";
    const redisReady = redisResult.status === "fulfilled";

    if (!postgresReady || !redisReady) {
      if (postgresResult.status === "rejected") {
        request.log.error(
          {
            err: postgresResult.reason,
            component: "postgres",
          },
          "Readiness check failed",
        );
      }

      if (redisResult.status === "rejected") {
        request.log.error(
          {
            err: redisResult.reason,
            component: "redis",
          },
          "Readiness check failed",
        );
      }
      return reply.code(503).send({ status: "not_ready" });
    }
    return reply.code(200).send({
      status: "ready",
    });
  });
};

export default healthRoutes;
