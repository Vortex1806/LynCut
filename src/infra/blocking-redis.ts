import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const blockingRedis = new Redis(env.REDIS_URL, {
  lazyConnect: true,

  maxRetriesPerRequest: null,

  retryStrategy(times) {
    return Math.min(times * 100, 20_000);
  },
});

blockingRedis.on("error", (error) => {
  logger.error("Blocking Redis error: " + error.message);
});
