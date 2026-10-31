import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import {
  api, createUser, createLink, migrateTestDatabase, resetDatabase, closeConnections,
} from "./helpers.js";
import { redis } from "../../src/infra/redis.js";

beforeAll(() => { migrateTestDatabase(); });
beforeEach(async () => { await resetDatabase(); });
afterAll(async () => { await closeConnections(); });

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("GET /:shortCode", () => {
  it("redirects with 302, never 301", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token, "https://example.com/target");

    const res = await api().get(`/${shortCode}`).expect(302);
    expect(res.headers.location).toBe("https://example.com/target");

    // 301 is cached permanently by the browser: repeat visits would never
    // reach the server, so analytics would undercount and disabling a
    // link would not work for anyone who had already followed it.
    expect(res.status).not.toBe(301);
  });

  it("needs no authentication", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token);
    await api().get(`/${shortCode}`).expect(302);
  });

  it("404s an unknown code", async () => {
    await api().get("/nosuchcode").expect(404);
  });

  it("populates the cache on a miss and serves from it afterwards", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token);

    expect(await redis.get(`link:${shortCode}`)).toBeNull();
    await api().get(`/${shortCode}`).expect(302);
    expect(await redis.get(`link:${shortCode}`)).not.toBeNull();
  });

  it("negative-caches an unknown code", async () => {
    await api().get("/ghostcode").expect(404);

    // Without this, a bot walking random codes turns every request into
    // a database read.
    expect(await redis.get("link:ghostcode")).not.toBeNull();
  });

  it("stops redirecting IMMEDIATELY when a link is disabled", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token);

    await api().get(`/${shortCode}`).expect(302);          // warms the cache
    await api().patch(`/api/links/${shortCode}/status`)
      .set(auth(token)).send({ isActive: false }).expect(200);

    // The write path must delete the cache key. Relying on the TTL would
    // leave a disabled link redirecting for minutes.
    await api().get(`/${shortCode}`).expect(404);
  });

  it("serves the new target IMMEDIATELY when a link is updated", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token, "https://example.com/old");

    await api().get(`/${shortCode}`).expect(302);
    await api().patch(`/api/links/${shortCode}`)
      .set(auth(token)).send({ targetUrl: "https://example.com/new" }).expect(200);

    const res = await api().get(`/${shortCode}`).expect(302);
    expect(res.headers.location).toBe("https://example.com/new");
  });

  it("404s a deleted link immediately", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token);

    await api().get(`/${shortCode}`).expect(302);
    await api().delete(`/api/links/${shortCode}`).set(auth(token)).expect(204);
    await api().get(`/${shortCode}`).expect(404);
  });

  it("does not shadow the API or health routes", async () => {
    // "/:shortCode" is mounted last; a static route must still win.
    await api().get("/healthz").expect(200);
    await api().get("/api/links").expect(401); // 401, not a 404 redirect lookup
  });

  it("publishes a visit event to the stream without blocking the response", async () => {
    const { token } = await createUser();
    const { shortCode } = await createLink(token);

    await api().get(`/${shortCode}`).expect(302);
    await api().get(`/${shortCode}`).expect(302);

    const len = await redis.xlen("link:visits");
    expect(len).toBeGreaterThanOrEqual(2);
  });
});
