import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import {
  api, createUser, migrateTestDatabase, resetDatabase, closeConnections,
} from "./helpers.js";

beforeAll(() => { migrateTestDatabase(); });
beforeEach(async () => { await resetDatabase(); });
afterAll(async () => { await closeConnections(); });

describe("POST /api/auth/signup", () => {
  it("creates a user and returns tokens", async () => {
    const res = await api().post("/api/auth/signup")
      .send({ name: "Shubh", email: "a@example.com", password: "supersecret123" })
      .expect(201);

    expect(res.body.user.email).toBe("a@example.com");
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.refreshToken).toBeTypeOf("string");
  });

  it("never returns the password hash", async () => {
    const res = await api().post("/api/auth/signup")
      .send({ name: "Shubh", email: "b@example.com", password: "supersecret123" })
      .expect(201);

    // The response schema is an allowlist; this proves it is wired up.
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("lowercases and trims the email", async () => {
    const res = await api().post("/api/auth/signup")
      .send({ name: "Shubh", email: "  MiXeD@Example.COM  ", password: "supersecret123" })
      .expect(201);

    expect(res.body.user.email).toBe("mixed@example.com");
  });

  it("rejects a duplicate email with 409", async () => {
    const body = { name: "Shubh", email: "dupe@example.com", password: "supersecret123" };
    await api().post("/api/auth/signup").send(body).expect(201);
    await api().post("/api/auth/signup").send(body).expect(409);
  });

  it("rejects a short password and a malformed email with 400", async () => {
    await api().post("/api/auth/signup")
      .send({ name: "S", email: "c@example.com", password: "short" }).expect(400);
    await api().post("/api/auth/signup")
      .send({ name: "S", email: "not-an-email", password: "supersecret123" }).expect(400);
  });
});

describe("POST /api/auth/login", () => {
  it("returns tokens for correct credentials", async () => {
    const { email } = await createUser();
    const res = await api().post("/api/auth/login")
      .send({ email, password: "supersecret123" }).expect(200);

    expect(res.body.accessToken).toBeTypeOf("string");
  });

  it("gives the same response for a wrong password and an unknown user", async () => {
    const { email } = await createUser();

    const wrongPassword = await api().post("/api/auth/login")
      .send({ email, password: "wrongpassword" }).expect(401);
    const unknownUser = await api().post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "supersecret123" }).expect(401);

    // Differing status codes or messages would be a user-enumeration oracle.
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });
});

describe("refresh and logout", () => {
  it("rotates the refresh token and invalidates the old one", async () => {
    const { email } = await createUser();
    const login = await api().post("/api/auth/login")
      .send({ email, password: "supersecret123" }).expect(200);

    const first = login.body.refreshToken;
    const refreshed = await api().post("/api/auth/refresh")
      .send({ refreshToken: first }).expect(200);

    expect(refreshed.body.refreshToken).not.toBe(first);

    // Rotation means the old token is dead — that is what makes a stolen
    // refresh token time-limited rather than permanent.
    await api().post("/api/auth/refresh").send({ refreshToken: first }).expect(401);
  });

  it("logout makes the refresh token unusable", async () => {
    const { email } = await createUser();
    const login = await api().post("/api/auth/login")
      .send({ email, password: "supersecret123" }).expect(200);

    await api().post("/api/auth/logout")
      .send({ refreshToken: login.body.refreshToken }).expect(204);

    // Without server-side storage "logout" would be a lie: the token
    // would still verify.
    await api().post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken }).expect(401);
  });

  it("rejects an unknown refresh token", async () => {
    await api().post("/api/auth/refresh")
      .send({ refreshToken: "nope-not-a-real-token" }).expect(401);
  });
});

describe("protected routes", () => {
  it("rejects missing, malformed and tampered tokens", async () => {
    await api().get("/api/links").expect(401);
    await api().get("/api/links").set("Authorization", "Token abc").expect(401);
    await api().get("/api/links").set("Authorization", "Bearer ").expect(401);

    const { token } = await createUser();
    const tampered = `${token.slice(0, -4)}AAAA`;
    await api().get("/api/links").set("Authorization", `Bearer ${tampered}`).expect(401);
  });
});
