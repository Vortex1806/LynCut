import type { Request, RequestHandler } from "express";
import { verifyAccessToken } from "../../modules/auth/jwt.js";
import { UnauthorizedError } from "../../shared/errors.js";

const BEARER_PREFIX = "Bearer ";

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  if (!token) {
    throw new UnauthorizedError("Missing bearer token");
  }

  req.user = { id: verifyAccessToken(token).sub };
  next();
};

export function userId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }

  return req.user.id;
}
