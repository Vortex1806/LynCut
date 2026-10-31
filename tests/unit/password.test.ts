import { describe, it, expect } from "vitest";
import { hash, verify } from "../../src/modules/auth/password.js";

describe("password hashing", () => {
  it("round-trips a correct password", async () => {
    const digest = await hash("correct horse battery staple");
    await expect(verify("correct horse battery staple", digest)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const digest = await hash("correct horse battery staple");
    await expect(verify("Correct horse battery staple", digest)).resolves.toBe(false);
    await expect(verify("", digest)).resolves.toBe(false);
  });

  it("produces a different digest each time", async () => {
    // argon2 generates a fresh salt per call, so identical passwords must
    // not produce identical hashes — otherwise the database leaks which
    // users share a password.
    const [a, b] = await Promise.all([hash("same"), hash("same")]);
    expect(a).not.toBe(b);
  });

  it("encodes argon2id and its parameters in the digest", async () => {
    // The parameters live in the string, which is why there is no salt
    // column and why the cost can be raised without breaking old hashes.
    expect(await hash("x")).toMatch(/^\$argon2id\$v=19\$m=\d+,p=\d+,t=\d+\$/);
  });

  it("returns false rather than throwing on a malformed digest", async () => {
    await expect(verify("x", "not-a-hash")).resolves.toBe(false);
    await expect(verify("x", "")).resolves.toBe(false);
  });
});
