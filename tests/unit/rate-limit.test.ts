import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Exercises the limiter configuration directly, on a throwaway app with a
 * low limit. The real limiters are raised in the test environment so they
 * do not throttle the rest of the suite; the behaviour under test is the
 * shape of the 429 and the keying, not the specific numbers.
 */
function buildApp(limit: number) {
  const app = express();
  app.set("trust proxy", 1);

  const limiter = rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
    handler: (_req, res) => {
      res.status(429).json({
        error: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please try again later.",
      });
    },
  });

  app.get("/limited", limiter, (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe("rate limiting", () => {
  it("allows up to the limit, then returns 429", async () => {
    const app = buildApp(3);
    const ip = "203.0.113.10";

    for (let i = 0; i < 3; i++) {
      await request(app).get("/limited").set("X-Forwarded-For", ip).expect(200);
    }
    await request(app).get("/limited").set("X-Forwarded-For", ip).expect(429);
  });

  it("returns the same JSON error shape as the rest of the API", async () => {
    const app = buildApp(1);
    const ip = "203.0.113.11";

    await request(app).get("/limited").set("X-Forwarded-For", ip).expect(200);
    const res = await request(app).get("/limited").set("X-Forwarded-For", ip).expect(429);

    // The limiter answers directly and never reaches the error handler, so
    // without a custom handler it would send plain text.
    expect(res.body).toEqual({
      error: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again later.",
    });
  });

  it("counts per client, not globally", async () => {
    const app = buildApp(1);

    await request(app).get("/limited").set("X-Forwarded-For", "203.0.113.20").expect(200);
    await request(app).get("/limited").set("X-Forwarded-For", "203.0.113.20").expect(429);

    // A different client must still have its full allowance.
    await request(app).get("/limited").set("X-Forwarded-For", "203.0.113.21").expect(200);
  });

  it("collapses an IPv6 /56 block to one key", async () => {
    const app = buildApp(1);

    await request(app).get("/limited")
      .set("X-Forwarded-For", "2001:db8:85a3:8d3:1319:8a2e:370:7348").expect(200);

    // Without ipKeyGenerator, varying the low bits would hand an IPv6 client
    // a fresh allowance per request and make the limit meaningless.
    await request(app).get("/limited")
      .set("X-Forwarded-For", "2001:db8:85a3:8d3:ffff:ffff:ffff:ffff").expect(429);
  });

  it("advertises the standard RateLimit header", async () => {
    const app = buildApp(5);
    const res = await request(app).get("/limited")
      .set("X-Forwarded-For", "203.0.113.30").expect(200);

    expect(res.headers["ratelimit"]).toMatch(/limit=5/);
  });
});
