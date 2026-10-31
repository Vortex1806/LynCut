import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors.js";
import {
  createLink,
  deleteLink,
  findByShortCode,
  listByUser,
  setActive,
  updateLink,
} from "./link.repository.js";
import { generateShortCode, validateCustomCode } from "./shortcode.js";
import { validateDestinationUrl } from "./url-safety.js";
import { redis } from "../../infra/redis.js";
import { logger } from "../../infra/logger.js";

type RedirectCacheEntry = {
  targetUrl: string;
  isActive: boolean;
};

const NOT_FOUND = "__NOT_FOUND__";

const REDIRECT_CACHE_TTL = 300;
const MAX_GENERATION_ATTEMPTS = 5;
const MAX_PAGE_SIZE = 100;
const NEGATIVE_CACHE_TTL = 60;

export class LinksService {
  private getCacheKey(shortCode: string): string {
    return `link:${shortCode}`;
  }

  private async invalidateCache(shortCode: string): Promise<void> {
    try {
      await redis.del(this.getCacheKey(shortCode));
    } catch (error) {
      logger.warn(
        { err: error, shortCode },
        "Failed to invalidate redirect cache",
      );
    }
  }

  /**
   * Prisma reports a unique-constraint violation as P2002, but `meta.target`
   * carries the DATABASE identifier ("short_code" / "links_short_code_key"),
   * not the Prisma field name — so matching on "shortCode" never fired and
   * the violation surfaced as a 500.
   *
   * On the Link model the only unique columns are id (a cuid, so a collision
   * is not a real scenario) and shortCode, which makes the code alone a
   * sufficient signal.
   */
  private isShortCodeUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
  }

  private isRecordNotFound(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2025"
    );
  }

  async create(input: {
    userId: string;
    targetUrl: string;
    customCode?: string;
  }) {
    const validatedUrl = await validateDestinationUrl(input.targetUrl);
    const targetUrl = validatedUrl.toString();

    // Custom codes should never be silently replaced.
    if (input.customCode !== undefined) {
      const shortCode = validateCustomCode(input.customCode);

      try {
        const link = await createLink({
          userId: input.userId,
          shortCode,
          targetUrl,
        });
        await this.invalidateCache(shortCode);
        return link;
      } catch (error) {
        if (this.isShortCodeUniqueViolation(error)) {
          throw new ConflictError("This short code is already taken.");
        }

        throw error;
      }
    }

    // Generate a new code if a collision occurs.
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const shortCode = generateShortCode();

      try {
        const link = await createLink({
          userId: input.userId,
          shortCode,
          targetUrl,
        });
        await this.invalidateCache(shortCode);
        return link;
      } catch (error) {
        if (!this.isShortCodeUniqueViolation(error)) {
          throw error;
        }
      }
    }

    throw new ConflictError(
      "Could not generate a unique short code. Please try again.",
    );
  }

  async list(input: { userId: string; limit?: number; cursor?: string }) {
    const limit = input.limit ?? 20;

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError("Limit must be between 1 and 100.");
    }

    if (input.cursor !== undefined && input.cursor.trim().length === 0) {
      throw new ValidationError("Cursor cannot be empty.");
    }

    return listByUser(input.userId, {
      limit,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
    });
  }

  async update(input: {
    userId: string;
    shortCode: string;
    targetUrl: string;
  }) {
    const validatedUrl = await validateDestinationUrl(input.targetUrl);

    try {
      const link = await updateLink({
        userId: input.userId,
        shortCode: input.shortCode,
        targetUrl: validatedUrl.toString(),
      });

      await this.invalidateCache(input.shortCode);

      return link;
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundError("Link not found.");
      }

      throw error;
    }
  }

  async setActive(input: {
    userId: string;
    shortCode: string;
    isActive: boolean;
  }) {
    try {
      const link = await setActive(input);

      await this.invalidateCache(input.shortCode);

      return link;
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundError("Link not found.");
      }

      throw error;
    }
  }

  async delete(input: { userId: string; shortCode: string }) {
    try {
      const link = await deleteLink(input);

      await this.invalidateCache(input.shortCode);

      return link;
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundError("Link not found.");
      }

      throw error;
    }
  }

  async getRedirectTarget(shortCode: string) {
    const cacheKey = this.getCacheKey(shortCode);
    let cached: string | null = null;

    try {
      cached = await redis.get(cacheKey);
    } catch (error) {
      logger.warn({ err: error, shortCode }, "Redis lookup failed");
    }

    if (cached !== null) {
      if (cached === NOT_FOUND) {
        throw new NotFoundError("Link not found.");
      }
      try {
        const entry = JSON.parse(cached) as RedirectCacheEntry;

        if (
          typeof entry.targetUrl === "string" &&
          typeof entry.isActive === "boolean"
        ) {
          if (!entry.isActive) {
            throw new NotFoundError("Link not found.");
          }
          return entry.targetUrl;
        }
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw error;
        }
        logger.warn({ err: error, shortCode }, "Invalid redirect cache entry");
      }
    }

    const link = await findByShortCode(shortCode);

    if (!link) {
      try {
        await redis.set(cacheKey, NOT_FOUND, "EX", NEGATIVE_CACHE_TTL);
      } catch (error) {
        logger.warn({ err: error, shortCode }, "Failed to cache missing link");
      }
      throw new NotFoundError("Link not found.");
    }

    const entry: RedirectCacheEntry = {
      targetUrl: link.targetUrl,
      isActive: link.isActive,
    };

    try {
      await redis.set(
        cacheKey,
        JSON.stringify(entry),
        "EX",
        REDIRECT_CACHE_TTL,
      );
    } catch (error) {
      logger.warn({ err: error, shortCode }, "Redis cache population failed");
    }

    if (!entry.isActive) {
      throw new NotFoundError("Link not found.");
    }

    return link.targetUrl;
  }
}
