import { execSync } from "node:child_process";
import request from "supertest";
import type { Express } from "express";

import { prisma } from "../../src/infra/prisma.js";
import { redis } from "../../src/infra/redis.js";
import { buildServer } from "../../src/http/server.js";

let app: Express | undefined;

/**
 * Applies migrations to the test database once per run. `migrate deploy`
 * rather than `dev`: no prompts, no shadow database, idempotent.
 */
export function migrateTestDatabase(): void {
  execSync("npx prisma migrate deploy", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
}

export function getApp(): Express {
  app ??= buildServer();
  return app;
}

/**
 * Truncating between tests, rather than recreating the schema, keeps the
 * suite fast and keeps tests independent of each other's order. CASCADE
 * takes links with users.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "links", "users" RESTART IDENTITY CASCADE',
  );
  await redis.flushdb();
}

export async function closeConnections(): Promise<void> {
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
}

let userCounter = 0;

/** Signs a fresh user up and returns their access token and id. */
export async function createUser(): Promise<{ token: string; id: string; email: string }> {
  const email = `user${++userCounter}-${Date.now()}@example.com`;

  const res = await request(getApp())
    .post("/api/auth/signup")
    .send({ name: "Test User", email, password: "supersecret123" })
    .expect(201);

  return { token: res.body.accessToken, id: res.body.user.id, email };
}

export async function createLink(
  token: string,
  targetUrl = "https://example.com/target",
  customCode?: string,
): Promise<{ shortCode: string; id: string }> {
  const res = await request(getApp())
    .post("/api/links")
    .set("Authorization", `Bearer ${token}`)
    .send(customCode === undefined ? { targetUrl } : { targetUrl, customCode })
    .expect(201);

  return { shortCode: res.body.shortCode, id: res.body.id };
}

export const api = () => request(getApp());
