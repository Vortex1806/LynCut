import { redis } from "../../infra/redis.js";
import { VISIT_STREAM, VISIT_STREAM_MAXLEN } from "./keys.js";

/**
 * Appends a visit to the stream. Callers must NOT await this on the redirect
 * path — the point of the stream is that counting never costs the user a
 * round trip. Fire it and attach a .catch().
 *
 * MAXLEN ~ caps the stream: without it, it grows until Redis runs out of
 * memory. The "~" means Redis trims to approximately this length at a
 * convenient boundary, which is far cheaper than trimming exactly.
 */
export async function recordVisit(shortCode: string): Promise<string | null> {
  return redis.xadd(
    VISIT_STREAM,
    "MAXLEN",
    "~",
    VISIT_STREAM_MAXLEN,
    "*",
    "shortCode",
    shortCode,
    "visitedAt",
    new Date().toISOString(),
  );
}
