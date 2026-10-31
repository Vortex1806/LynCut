import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { signAccessToken, verifyAccessToken } from "../../src/modules/auth/jwt.js";
import { UnauthorizedError } from "../../src/shared/errors.js";

const SECRET = process.env.JWT_SECRET as string;

describe("access tokens", () => {
  it("round-trips the user id", () => {
    expect(verifyAccessToken(signAccessToken("user-123")).sub).toBe("user-123");
  });

  it("expires in 15 minutes", () => {
    const payload = jwt.decode(signAccessToken("u")) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(900);
  });

  it("rejects a token signed with a different secret", () => {
    const forged = jwt.sign({}, "an-entirely-different-secret-value-x", {
      subject: "attacker", algorithm: "HS256", expiresIn: "15m",
      issuer: "lyncut", audience: "lyncut-api",
    });
    expect(() => verifyAccessToken(forged)).toThrow(UnauthorizedError);
  });

  it("rejects a token with the wrong issuer or audience", () => {
    // Signing claims without verifying them is a no-op; these prove the
    // verify side actually checks.
    const wrongAud = jwt.sign({}, SECRET, {
      subject: "u", algorithm: "HS256", expiresIn: "15m",
      issuer: "lyncut", audience: "someone-else",
    });
    const wrongIss = jwt.sign({}, SECRET, {
      subject: "u", algorithm: "HS256", expiresIn: "15m",
      issuer: "someone-else", audience: "lyncut-api",
    });
    expect(() => verifyAccessToken(wrongAud)).toThrow(UnauthorizedError);
    expect(() => verifyAccessToken(wrongIss)).toThrow(UnauthorizedError);
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({}, SECRET, {
      subject: "u", algorithm: "HS256", expiresIn: "-1s",
      issuer: "lyncut", audience: "lyncut-api",
    });
    expect(() => verifyAccessToken(expired)).toThrow(UnauthorizedError);
  });

  it("rejects the alg=none confusion attack", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({
      sub: "attacker", iss: "lyncut", aud: "lyncut-api",
      exp: Math.floor(Date.now() / 1000) + 900,
    })).toString("base64url");
    expect(() => verifyAccessToken(`${header}.${body}.`)).toThrow(UnauthorizedError);
  });

  it("rejects junk", () => {
    expect(() => verifyAccessToken("")).toThrow(UnauthorizedError);
    expect(() => verifyAccessToken("a.b.c")).toThrow(UnauthorizedError);
  });
});
