import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../shared/errors.js";

const ISSUER = "lyncut";
const AUDIENCE = "lyncut-api";
const ACCESS_TOKEN_TTL = "15m";

export interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, {
    subject: userId,
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/**
 * Verifies signature, expiry, issuer, audience and algorithm.
 * Pinning `algorithms` prevents algorithm-confusion attacks.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }

  if (
    typeof decoded !== "object" ||
    decoded === null ||
    !("sub" in decoded) ||
    typeof decoded.sub !== "string"
  ) {
    throw new UnauthorizedError("Invalid or expired access token");
  }

  return { sub: decoded.sub };
}
