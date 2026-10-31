import { Router } from "express";
import { isShuttingDown } from "../../shared/lifecycle.js";
import { withTimeout } from "../../shared/with-timeout.js";
import { prisma } from "../../infra/prisma.js";
import { redis } from "../../infra/redis.js";
import { logger } from "../../infra/logger.js";

const DEPENDENCY_TIMEOUT_MS = 2_000;

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/readyz", async (req, res) => {
    if (isShuttingDown()) {
      return res.status(503).json({ status: "shutting_down" });
    }

    const [postgres, redisResult] = await Promise.allSettled([
      withTimeout(
        prisma.$queryRaw`SELECT 1`,
        DEPENDENCY_TIMEOUT_MS,
        "postgres",
      ),
      withTimeout(redis.ping(), DEPENDENCY_TIMEOUT_MS, "redis"),
    ]);

    const log = req.log ?? logger;

    if (postgres.status === "rejected") {
      log.error(
        { err: postgres.reason, component: "postgres" },
        "Readiness check failed",
      );
    }

    if (redisResult.status === "rejected") {
      log.error(
        { err: redisResult.reason, component: "redis" },
        "Readiness check failed",
      );
    }

    if (postgres.status === "rejected" || redisResult.status === "rejected") {
      return res.status(503).json({ status: "not_ready" });
    }

    return res.status(200).json({ status: "ready" });
  });

  return router;
}
