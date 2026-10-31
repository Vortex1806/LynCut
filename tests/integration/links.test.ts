import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  api, createUser, createLink, migrateTestDatabase, resetDatabase, closeConnections,
} from "./helpers.js";

beforeAll(() => { migrateTestDatabase(); });
beforeEach(async () => { await resetDatabase(); });
afterAll(async () => { await closeConnections(); });

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("POST /api/links", () => {
  it("creates a link with a generated code", async () => {
    const { token } = await createUser();
    const res = await api().post("/api/links").set(auth(token))
      .send({ targetUrl: "https://example.com/a" }).expect(201);

    expect(res.body.shortCode).toHaveLength(7);
    expect(res.body.visitCount).toBe(0);
    expect(res.body.isActive).toBe(true);
    // userId is not in the response schema and must not leak.
    expect(res.body.userId).toBeUndefined();
  });

  it("accepts a custom code", async () => {
    const { token } = await createUser();
    const res = await api().post("/api/links").set(auth(token))
      .send({ targetUrl: "https://example.com/a", customCode: "myCode" }).expect(201);

    expect(res.body.shortCode).toBe("myCode");
  });

  it("returns 409 for a duplicate custom code, and does not hang", async () => {
    const { token } = await createUser();
    await createLink(token, "https://example.com/a", "takenCode");

    // The unique constraint is the only correct arbiter here: a
    // check-then-insert would race. In Express 4 this bug hung the request.
    await api().post("/api/links").set(auth(token))
      .send({ targetUrl: "https://example.com/b", customCode: "takenCode" }).expect(409);
  });

  it("rejects a reserved code", async () => {
    const { token } = await createUser();
    await api().post("/api/links").set(auth(token))
      .send({ targetUrl: "https://example.com/a", customCode: "healthz" }).expect(400);
  });

  it("rejects dangerous destination URLs", async () => {
    const { token } = await createUser();
    for (const targetUrl of [
      "javascript:alert(1)",
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:6379/",
      "not-a-url",
    ]) {
      await api().post("/api/links").set(auth(token)).send({ targetUrl }).expect(400);
    }
  });
});

describe("idempotency", () => {
  it("returns the same link for a repeated key", async () => {
    const { token } = await createUser();
    const key = randomUUID();
    const body = { targetUrl: "https://example.com/idem" };

    const first = await api().post("/api/links")
      .set(auth(token)).set("Idempotency-Key", key).send(body).expect(201);
    const second = await api().post("/api/links")
      .set(auth(token)).set("Idempotency-Key", key).send(body).expect(201);

    expect(second.body.shortCode).toBe(first.body.shortCode);

    const list = await api().get("/api/links").set(auth(token)).expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it("releases the key when the request fails, so a retry can succeed", async () => {
    const { token } = await createUser();
    const key = randomUUID();

    await api().post("/api/links").set(auth(token)).set("Idempotency-Key", key)
      .send({ targetUrl: "not-a-url" }).expect(400);

    // Leaving the sentinel in place would lock this key for 24 hours over
    // a single typo.
    await api().post("/api/links").set(auth(token)).set("Idempotency-Key", key)
      .send({ targetUrl: "https://example.com/retry" }).expect(201);
  });

  it("scopes keys per user", async () => {
    const a = await createUser();
    const b = await createUser();
    const key = randomUUID();

    const first = await api().post("/api/links").set(auth(a.token))
      .set("Idempotency-Key", key).send({ targetUrl: "https://example.com/a" }).expect(201);
    const second = await api().post("/api/links").set(auth(b.token))
      .set("Idempotency-Key", key).send({ targetUrl: "https://example.com/b" }).expect(201);

    // An unscoped key would replay user A's response to user B.
    expect(second.body.shortCode).not.toBe(first.body.shortCode);
  });
});

describe("ownership", () => {
  it("lists only your own links", async () => {
    const a = await createUser();
    const b = await createUser();
    await createLink(a.token, "https://example.com/a");

    const res = await api().get("/api/links").set(auth(b.token)).expect(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("404s — not 403 — when another user targets your link", async () => {
    const a = await createUser();
    const b = await createUser();
    const { shortCode } = await createLink(a.token);

    // 403 would confirm the code exists. 404 reveals nothing.
    await api().delete(`/api/links/${shortCode}`).set(auth(b.token)).expect(404);
    // An IP literal, not a hostname: update() validates the URL before it
    // reaches the ownership check, and an unresolvable host would fail at
    // validation with a 400 instead of exercising what this test is for.
    await api().patch(`/api/links/${shortCode}`).set(auth(b.token))
      .send({ targetUrl: "https://8.8.8.8/evil" }).expect(404);
    await api().patch(`/api/links/${shortCode}/status`).set(auth(b.token))
      .send({ isActive: false }).expect(404);

    // And the link is untouched.
    await api().get(`/${shortCode}`).expect(302);
  });
});

describe("GET /api/links", () => {
  it("paginates with a cursor", async () => {
    const { token } = await createUser();
    for (let i = 0; i < 5; i++) await createLink(token, `https://example.com/${i}`);

    const first = await api().get("/api/links?limit=2").set(auth(token)).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTypeOf("string");

    const second = await api()
      .get(`/api/links?limit=2&cursor=${first.body.nextCursor}`)
      .set(auth(token)).expect(200);

    const ids = new Set([...first.body.items, ...second.body.items].map((l: { id: string }) => l.id));
    expect(ids.size).toBe(4); // no overlap between pages
  });

  it("rejects an out-of-range limit", async () => {
    const { token } = await createUser();
    await api().get("/api/links?limit=500").set(auth(token)).expect(400);
    await api().get("/api/links?limit=0").set(auth(token)).expect(400);
  });
});
