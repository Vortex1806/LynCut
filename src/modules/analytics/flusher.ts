import { prisma } from "../../infra/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { logger } from "../../infra/logger.js";
import { redis } from "../../infra/redis.js";
import { isShuttingDown } from "../../shared/lifecycle.js";
import { VISIT_COUNTS_HASH, VISIT_COUNTS_PROCESSING } from "./keys.js";

const COUNTS_HASH = VISIT_COUNTS_HASH;
const PROCESSING_HASH = VISIT_COUNTS_PROCESSING;

const FLUSH_INTERVAL_MS = 10_000;

/** Resolves early when shutdown begins, so the final flush is not delayed. */
let wakeEarly: (() => void) | null = null;

export function wakeFlusher(): void {
  wakeEarly?.();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    wakeEarly = finish;

    function finish(): void {
      clearTimeout(timer);
      wakeEarly = null;
      resolve();
    }
  });
}

type VisitCount = {
  shortCode: string;
  count: number;
};

async function readProcessingCounts(): Promise<VisitCount[]> {
  const data = await redis.hgetall(PROCESSING_HASH);

  return Object.entries(data).map(([shortCode, count]) => ({
    shortCode,
    count: Number(count),
  }));
}

async function persistCounts(counts: VisitCount[]): Promise<void> {
  if (counts.length === 0) return;

  await prisma.$transaction(async (tx) => {
    const values = Prisma.join(
      counts.map(
        ({ shortCode, count }) =>
          Prisma.sql`(${shortCode}::text, ${count}::int)`,
      ),
    );
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE links AS l
        SET visit_count = l.visit_count + v.delta
        FROM (VALUES ${values}) AS v(code, delta)
        WHERE l.short_code = v.code
      `,
    );
  });
}

async function flushProcessingHash(): Promise<void> {
  const counts = await readProcessingCounts();
  if (counts.length === 0) {
    await redis.del(PROCESSING_HASH);
    return;
  }

  await persistCounts(counts);

  await redis.del(PROCESSING_HASH);
  logger.info(
    { linksUpdated: counts.length },
    "Visit counts flushed to PostgreSQL",
  );
}

export async function flushVisitCounts(): Promise<void> {
  if (await redis.exists(PROCESSING_HASH)) {
    await flushProcessingHash();
  }
  if (!(await redis.exists(COUNTS_HASH))) {
    return;
  }
  await redis.rename(COUNTS_HASH, PROCESSING_HASH);

  await flushProcessingHash();
}

/**
 * Runs the flusher periodically.
 */
export async function startFlusher(): Promise<void> {
  logger.info({ intervalMs: FLUSH_INTERVAL_MS }, "Analytics flusher started");

  while (!isShuttingDown()) {
    try {
      await flushVisitCounts();
    } catch (error) {
      logger.error({ err: error }, "Failed to flush visit counts");
    }

    if (isShuttingDown()) break;

    // Interruptible: shutdown calls wakeFlusher() rather than waiting out
    // the full interval doing nothing.
    await sleep(FLUSH_INTERVAL_MS);
  }

  logger.info("Analytics flusher stopped");
}
