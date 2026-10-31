import type { RequestHandler } from "express";

import { redis } from "../../infra/redis.js";
import { logger } from "../../infra/logger.js";
import { ValidationError, ConflictError } from "../../shared/errors.js";
import { userId } from "./require-auth.js";

const IN_FLIGHT_TTL = 60;
const RESPONSE_TTL = 60 * 60 * 24;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type StoredResponse = {
  statusCode: number;
  body: unknown;
};

export function idempotent(): RequestHandler {
  return async (req, res, next) => {
    try {
      // 1. Read the idempotency key
      const key = req.get("Idempotency-Key");

      // 2. Header is optional
      if (key === undefined) {
        return next();
      }

      // 3. Validate the client-supplied key
      if (!KEY_PATTERN.test(key)) {
        throw new ValidationError("Invalid Idempotency-Key.");
      }

      // 4. Get the authenticated user ID
      const authenticatedUserId = userId(req);

      // 5. Create a user-specific Redis key
      const storeKey = `idem:${authenticatedUserId}:${key}`;

      // 6. Atomically claim the key
      const claimed = await redis.set(
        storeKey,
        "in-flight",
        "EX",
        IN_FLIGHT_TTL,
        "NX",
      );

      // 7. Someone already owns this key
      if (claimed === null) {
        const existing = await redis.get(storeKey);

        // 8. Original request is still running
        if (existing === "in-flight") {
          throw new ConflictError(
            "A request with this idempotency key is already processing.",
          );
        }

        // 9. Replay the previously stored response
        if (existing !== null) {
          const stored = JSON.parse(existing) as StoredResponse;
          res.setHeader("Idempotent-Replay", "true");
          return res.status(stored.statusCode).json(stored.body);
        }

        // Key expired or disappeared between Redis operations.
        throw new ConflictError(
          "Unable to resolve this idempotency key. Please retry.",
        );
      }

      // 10. Save the original Express res.json method
      const originalJson = res.json.bind(res);

      // 11. Intercept JSON responses
      res.json = ((body: unknown) => {
        const statusCode = res.statusCode;

        if (statusCode >= 200 && statusCode < 300) {
          const response: StoredResponse = {
            statusCode,
            body,
          };

          // 12. Save successful response without delaying the HTTP response
          void redis
            .set(storeKey, JSON.stringify(response), "EX", RESPONSE_TTL)
            .catch((error) => {
              logger.error(
                { err: error, storeKey },
                "Failed to store idempotent response",
              );
            });
        } else {
          // 13. Failed requests must be retryable
          void redis.del(storeKey).catch((error) => {
            logger.error(
              { err: error, storeKey },
              "Failed to release idempotency key",
            );
          });
        }

        // 14. Send the actual response
        return originalJson(body);
      }) as typeof res.json;

      // 15. Continue to the next middleware / route handler
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
