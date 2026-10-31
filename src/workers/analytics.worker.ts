import os from "node:os";

import { logger } from "../infra/logger.js";
import { blockingRedis } from "../infra/blocking-redis.js";
import { env } from "../config/env.js";
import { redis } from "../infra/redis.js";
import { startFlusher } from "../modules/analytics/flusher.js";

const STREAM = "link:visits";
const GROUP = "analytics-workers";
const COUNTS_HASH = "link:visit-counts";

const BATCH_SIZE = 100;
const BLOCK_MS = 5_000;

const consumerName = `${env.WORKER_NAME ?? os.hostname()}-${process.pid}`;

type StreamEntry = [id: string, fields: string[]];

async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM");
  } catch (error) {
    if (error instanceof Error && error.message.includes("BUSYGROUP")) {
      return;
    }
    throw error;
  }
}

function getShortCode(fields: string[]): string | null {
  for (let i = 0; i < fields.length; i++) {
    if (fields[i] === "shortCode") {
      return fields[i + 1] ?? null;
    }
  }
  return null;
}

async function processBatch(entries: StreamEntry[]): Promise<void> {
  const counts = new Map<string, number>();
  const messageIds: string[] = [];

  for (const [messageId, fields] of entries) {
    const shortCode = getShortCode(fields);

    if (!shortCode) {
      logger.warn({ messageId }, "Visit event has no shortCode; discarding");
      messageIds.push(messageId);
      continue;
    }

    counts.set(shortCode, (counts.get(shortCode) ?? 0) + 1);

    messageIds.push(messageId);
  }

  const pipeline = redis.pipeline();

  for (const [shortCode, count] of counts) {
    pipeline.hincrby(COUNTS_HASH, shortCode, count);
  }

  if (counts.size > 0) {
    const results = await pipeline.exec();

    if (results === null) {
      throw new Error("Redis pipeline returned no results");
    }

    for (const [error] of results) {
      if (error) {
        throw error;
      }
    }
  }

  if (messageIds.length > 0) {
    await redis.xack(STREAM, GROUP, ...messageIds);
  }
}

async function runWorker(): Promise<void> {
  await ensureConsumerGroup();

  logger.info(
    { consumerName, stream: STREAM, group: GROUP },
    "Analytics worker started",
  );

  while (true) {
    const result = await blockingRedis.xreadgroup(
      "GROUP",
      GROUP,
      consumerName,
      "COUNT",
      BATCH_SIZE,
      "BLOCK",
      BLOCK_MS,
      "STREAMS",
      STREAM,
      ">",
    );

    if (!result) {
      continue;
    }

    for (const [, rawEntries] of result) {
      const entries = rawEntries as StreamEntry[];
      await processBatch(entries);
    }
  }
}

async function main(): Promise<void> {
  await Promise.all([runWorker(), startFlusher()]);
}

main().catch(async (error) => {
  logger.fatal({ err: error }, "Analytics worker crashed");

  await Promise.allSettled([redis.quit(), blockingRedis.quit()]);

  process.exit(1);
});
