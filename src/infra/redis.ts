import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  retryStrategy(times) {
    return Math.min(times * 100, 20_000);
  },
});

redis.on("connect", () => {
  logger.info("Redis: connecting");
});

redis.on("ready", () => {
  logger.info("Redis: ready");
});

redis.on("reconnecting", (delay: number) => {
  logger.warn({ ms: delay }, `Redis: reconnecting`);
});

redis.on("error", (error) => {
  logger.error({ err: error }, "Redis error");
});
