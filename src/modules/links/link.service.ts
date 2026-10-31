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

const MAX_GENERATION_ATTEMPTS = 5;
const MAX_PAGE_SIZE = 100;

export class LinksService {
  private getCacheKey(shortCode: string): string {
    return `link:${shortCode}`;
  }

  private async invalidateCache(shortCode: string): Promise<void> {
    await redis.del(this.getCacheKey(shortCode));
  }

  private isShortCodeUniqueViolation(error: unknown): boolean {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "P2002" ||
      !("meta" in error) ||
      typeof error.meta !== "object" ||
      error.meta === null ||
      !("target" in error.meta)
    ) {
      return false;
    }

    const target = error.meta.target;

    return Array.isArray(target)
      ? target.includes("shortCode")
      : typeof target === "string" && target.includes("shortCode");
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
        return await createLink({
          userId: input.userId,
          shortCode,
          targetUrl,
        });
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
        return await createLink({
          userId: input.userId,
          shortCode,
          targetUrl,
        });
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
    const link = await findByShortCode(shortCode);

    if (!link || !link.isActive) {
      throw new NotFoundError("Link not found.");
    }

    return link.targetUrl;
  }
}
