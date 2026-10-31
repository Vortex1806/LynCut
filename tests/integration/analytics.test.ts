import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import {
  createUser, createLink, migrateTestDatabase, resetDatabase, closeConnections,
} from "./helpers.js";
import { redis } from "../../src/infra/redis.js";
import { prisma } from "../../src/infra/prisma.js";
import { recordVisit } from "../../src/modules/analytics/events.js";
import { processBatch } from "../../src/modules/analytics/consumer.js";
import { flushVisitCounts } from "../../src/modules/analytics/flusher.js";
import {
  VISIT_COUNTS_HASH, VISIT_GROUP, VISIT_STREAM,
} from "../../src/modules/analytics/keys.js";

beforeAll(() => { migrateTestDatabase(); });
beforeEach(async () => { await resetDatabase(); });
afterAll(async () => { await closeConnections(); });

/** Reads one batch the way the worker's main loop does. */
async function consumeOnce(consumer = "test-consumer"): Promise<number> {
  await redis.xgroup("CREATE", VISIT_STREAM, VISIT_GROUP, "0", "MKSTREAM").catch(() => {});

  const result = await redis.xreadgroup(
    "GROUP", VISIT_GROUP, consumer, "COUNT", 100, "STREAMS", VISIT_STREAM, ">",
  );

  const entries = (Array.isArray(result) && Array.isArray(result[0])
    ? result[0][1]
    : []) as [string, string[]][];

  await processBatch(entries);
  return entries.length;
}

describe("the analytics pipeline", () => {
  it("aggregates duplicate codes into a single increment", async () => {
    for (const code of ["aaa", "bbb", "aaa", "aaa"]) await recordVisit(code);
    await consumeOnce();

    expect(await redis.hget(VISIT_COUNTS_HASH, "aaa")).toBe("3");
    expect(await redis.hget(VISIT_COUNTS_HASH, "bbb")).toBe("1");
  });

  it("acks everything it consumes", async () => {
    await recordVisit("aaa");
    await consumeOnce();

    const pending = await redis.xpending(VISIT_STREAM, VISIT_GROUP);
    expect(pending[0]).toBe(0);
  });

  it("does NOT replay the stream on restart", async () => {
    await recordVisit("aaa");
    await recordVisit("aaa");
    expect(await consumeOnce()).toBe(2);

    // The group tracks position server-side. The old version kept a local
    // cursor starting at 0-0, so every restart recounted the whole stream.
    expect(await consumeOnce()).toBe(0);
    expect(await redis.hget(VISIT_COUNTS_HASH, "aaa")).toBe("2");
  });

  it("leaves unacked messages recoverable after a crash", async () => {
    await recordVisit("aaa");
    await redis.xgroup("CREATE", VISIT_STREAM, VISIT_GROUP, "0", "MKSTREAM").catch(() => {});

    // Delivered to a consumer that then "dies" without acking.
    await redis.xreadgroup(
      "GROUP", VISIT_GROUP, "doomed-worker", "COUNT", 10, "STREAMS", VISIT_STREAM, ">",
    );
    expect((await redis.xpending(VISIT_STREAM, VISIT_GROUP))[0]).toBe(1);

    // Reading id "0" returns that consumer's own pending list. Note it
    // returns an empty array rather than null when there is nothing —
    // a loop that breaks on null would spin forever.
    const own = await redis.xreadgroup(
      "GROUP", VISIT_GROUP, "doomed-worker", "COUNT", 10, "STREAMS", VISIT_STREAM, "0",
    );
    const entries = (Array.isArray(own) && Array.isArray(own[0])
      ? own[0][1] : []) as [string, string[]][];

    expect(entries).toHaveLength(1);
    await processBatch(entries);
    expect((await redis.xpending(VISIT_STREAM, VISIT_GROUP))[0]).toBe(0);
  });

  it("discards an unparseable message instead of redelivering it forever", async () => {
    await redis.xadd(VISIT_STREAM, "*", "wrongField", "nonsense");
    await consumeOnce();
    expect((await redis.xpending(VISIT_STREAM, VISIT_GROUP))[0]).toBe(0);
  });
});

describe("the flusher", () => {
  it("writes aggregated counts to Postgres and drains the hash", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token);

    for (let i = 0; i < 3; i++) await recordVisit(shortCode);
    await consumeOnce();
    await flushVisitCounts();

    const link = await prisma.link.findUnique({ where: { shortCode } });
    expect(link?.visitCount).toBe(3);
    expect(await redis.hget(VISIT_COUNTS_HASH, shortCode)).toBeNull();
  });

  it("ACCUMULATES across flushes rather than overwriting", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token);

    for (let i = 0; i < 3; i++) await recordVisit(shortCode);
    await consumeOnce();
    await flushVisitCounts();

    for (let i = 0; i < 2; i++) await recordVisit(shortCode);
    await consumeOnce();
    await flushVisitCounts();

    // "= delta" instead of "+= delta" would leave this at 2.
    const link = await prisma.link.findUnique({ where: { shortCode } });
    expect(link?.visitCount).toBe(5);
  });

  it("updates many links in one statement", async () => {
    const { token } = await createUser();
    const a = await createLink(token, "https://example.com/a");
    const b = await createLink(token, "https://example.com/b");

    await recordVisit(a.shortCode);
    await recordVisit(b.shortCode);
    await recordVisit(b.shortCode);
    await consumeOnce();
    await flushVisitCounts();

    expect((await prisma.link.findUnique({ where: { shortCode: a.shortCode } }))?.visitCount).toBe(1);
    expect((await prisma.link.findUnique({ where: { shortCode: b.shortCode } }))?.visitCount).toBe(2);
  });

  it("is a no-op when there is nothing to flush", async () => {
    await expect(flushVisitCounts()).resolves.toBeUndefined();
  });

  it("ignores counts for codes that no longer exist", async () => {
    // A link deleted between the visit and the flush must not break the batch.
    await recordVisit("deleted-code");
    await consumeOnce();
    await expect(flushVisitCounts()).resolves.toBeUndefined();
  });
});
