import os from "node:os";

import { env } from "../../config/env.js";
import { blockingRedis } from "../../infra/blocking-redis.js";
import { logger } from "../../infra/logger.js";
import { redis } from "../../infra/redis.js";
import { isShuttingDown } from "../../shared/lifecycle.js";
import { VISIT_COUNTS_HASH, VISIT_GROUP, VISIT_STREAM } from "./keys.js";

const BATCH_SIZE = 100;

/**
 * How long XREADGROUP parks waiting for new entries. Shutdown cannot
 * interrupt a blocked read, so this is also the worst-case delay before
 * the loop notices it should stop — keep it well under the shutdown budget.
 */
const BLOCK_MS = 5_000;

/**
 * Only claim messages idle at least this long. Claiming at 0 would steal
 * work from a consumer that is merely busy, and process it twice.
 */
const CLAIM_IDLE_MS = 60_000;

/**
 * Must be stable across restarts: the pending-entries list is keyed by it,
 * so a name that changes every boot orphans its own unacked messages.
 * In Docker the hostname is the container id, which changes when the
 * container is recreated — pin WORKER_NAME in compose.
 */
export const consumerName = env.WORKER_NAME ?? os.hostname();

type StreamEntry = [id: string, fields: string[]];

/** Updated each time round the loop, so a health check can spot a hang. */
let lastLoopAt = Date.now();

export function getLastLoopAt(): number {
  return lastLoopAt;
}

/** One STREAMS key means one element; narrow it rather than casting blind. */
function entriesFrom(result: unknown): StreamEntry[] {
  if (!Array.isArray(result)) return [];

  const first: unknown = result[0];
  if (!Array.isArray(first)) return [];

  const entries: unknown = first[1];
  return Array.isArray(entries) ? (entries as StreamEntry[]) : [];
}

async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup("CREATE", VISIT_STREAM, VISIT_GROUP, "0", "MKSTREAM");
    logger.info(
      { stream: VISIT_STREAM, group: VISIT_GROUP },
      "Consumer group created",
    );
  } catch (error) {
    // Expected on every restart after the first; there is no "create if absent".
    if (error instanceof Error && error.message.includes("BUSYGROUP")) {
      return;
    }
    throw error;
  }
}

function getShortCode(fields: string[]): string | null {
  // Stream fields arrive as flat pairs: [name, value, name, value, ...]
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === "shortCode") {
      return fields[i + 1] ?? null;
    }
  }
  return null;
}

/**
 * Aggregate in memory, write the whole batch in one pipeline, then ack.
 *
 * Acking only after the increments land is what makes this at-least-once:
 * a crash in between redelivers the batch and over-counts, which is
 * recoverable. Acking first would be at-most-once — a crash would lose the
 * batch silently, which is not.
 */
export async function processBatch(entries: StreamEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const counts = new Map<string, number>();
  const messageIds: string[] = [];

  for (const [messageId, fields] of entries) {
    messageIds.push(messageId);

    const shortCode = getShortCode(fields);

    if (!shortCode) {
      // Ack it regardless: an unparseable message would redeliver forever.
      logger.warn({ messageId }, "Visit event has no shortCode; discarding");
      continue;
    }

    counts.set(shortCode, (counts.get(shortCode) ?? 0) + 1);
  }

  if (counts.size > 0) {
    const pipeline = redis.pipeline();

    for (const [shortCode, count] of counts) {
      pipeline.hincrby(VISIT_COUNTS_HASH, shortCode, count);
    }

    const results = await pipeline.exec();

    if (results === null) {
      throw new Error("Redis pipeline returned no results");
    }

    for (const [error] of results) {
      if (error) throw error;
    }
  }

  await redis.xack(VISIT_STREAM, VISIT_GROUP, ...messageIds);
}

/**
 * Messages already delivered to THIS consumer name but never acked — the
 * batch a previous process was holding when it died.
 *
 * Reading id "0" returns this consumer's pending list. Unlike ">", it never
 * returns null: an empty pending list comes back as an empty entry array,
 * so the loop must terminate on that, not on a null result.
 */
async function recoverOwnPending(): Promise<void> {
  let recovered = 0;

  while (true) {
    const result = await redis.xreadgroup(
      "GROUP",
      VISIT_GROUP,
      consumerName,
      "COUNT",
      BATCH_SIZE,
      "STREAMS",
      VISIT_STREAM,
      "0",
    );

    const entries = entriesFrom(result);
    if (entries.length === 0) break;

    await processBatch(entries);
    recovered += entries.length;
  }

  if (recovered > 0) {
    logger.info({ recovered, consumerName }, "Recovered own pending messages");
  }
}

/**
 * Messages stranded under OTHER consumer names — a worker that was scaled
 * down, or whose hostname changed. Without this they stay pending forever,
 * because they are already assigned to a consumer that will never return.
 */
async function claimOrphanedMessages(): Promise<void> {
  let cursor = "0-0";
  let claimed = 0;

  while (true) {
    const result = (await redis.xautoclaim(
      VISIT_STREAM,
      VISIT_GROUP,
      consumerName,
      CLAIM_IDLE_MS,
      cursor,
      "COUNT",
      BATCH_SIZE,
    )) as [string, StreamEntry[], string[]];

    const [nextCursor, entries] = result;

    if (entries.length > 0) {
      await processBatch(entries);
      claimed += entries.length;
    }

    cursor = nextCursor;

    // XAUTOCLAIM returns "0-0" once it has swept the whole pending list.
    if (cursor === "0-0") break;
  }

  if (claimed > 0) {
    logger.info({ claimed, consumerName }, "Claimed orphaned messages");
  }
}

/**
 * Runs until shutdown begins. The flag is checked only at the top of the
 * loop, never mid-batch: a batch that has been incremented but not acked
 * would just be redelivered on the next boot.
 */
export async function runConsumer(): Promise<void> {
  await ensureConsumerGroup();
  await recoverOwnPending();
  await claimOrphanedMessages();

  logger.info(
    { consumerName, stream: VISIT_STREAM, group: VISIT_GROUP },
    "Analytics consumer started",
  );

  while (!isShuttingDown()) {
    lastLoopAt = Date.now();

    // ">" = entries never delivered to this group. Returns null when nothing
    // arrives within BLOCK_MS, which is the ordinary idle case.
    const result = await blockingRedis.xreadgroup(
      "GROUP",
      VISIT_GROUP,
      consumerName,
      "COUNT",
      BATCH_SIZE,
      "BLOCK",
      BLOCK_MS,
      "STREAMS",
      VISIT_STREAM,
      ">",
    );

    if (result === null) continue;

    await processBatch(entriesFrom(result));
  }

  logger.info({ consumerName }, "Analytics consumer stopped");
}
