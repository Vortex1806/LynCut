import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { logger } from "../../infra/logger.js";
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

export const authLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 5 });

export const refreshLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 3,
});

export const apiLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
});
