import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { logger } from "../../infra/logger.js";
import { env } from "../../config/env.js";
import type { Request, Response } from "express";

const common = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    (req.log ?? logger).warn(
      { ip: req.ip, path: req.path },
      "Rate limit exceeded",
    );
    res.status(429).json({
      error: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again later.",
    });
  },
};

export const authLimiter = rateLimit({ ...common, windowMs: 60_000, limit: env.RATE_LIMIT_AUTH_MAX });

export const refreshLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: env.RATE_LIMIT_REFRESH_MAX,
});

export const apiLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: env.RATE_LIMIT_API_MAX,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
});
