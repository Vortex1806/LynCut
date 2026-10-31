import { describe, it, expect } from "vitest";
import {
  generateShortCode,
  validateCustomCode,
} from "../../src/modules/links/shortcode.js";
import { ValidationError } from "../../src/shared/errors.js";

describe("generateShortCode", () => {
  it("produces 7 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode();
      expect(code).toHaveLength(7);
      // No 0/O or 1/l/I: codes must survive being read aloud or typed
      // from a screenshot.
      expect(code).toMatch(/^[23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]+$/);
    }
  });

  it("does not repeat over many draws", () => {
    const codes = new Set(Array.from({ length: 2000 }, generateShortCode));
    expect(codes.size).toBe(2000);
  });
});

describe("validateCustomCode", () => {
  it("accepts codes within the length bounds", () => {
    expect(validateCustomCode("abcd")).toBe("abcd");
    expect(validateCustomCode("myCode23")).toBe("myCode23");
    expect(validateCustomCode("a".repeat(32))).toHaveLength(32);
  });

  it("rejects codes outside the length bounds", () => {
    expect(() => validateCustomCode("abc")).toThrow(ValidationError);
    expect(() => validateCustomCode("a".repeat(33))).toThrow(ValidationError);
    expect(() => validateCustomCode("")).toThrow(ValidationError);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => validateCustomCode("has space")).toThrow(ValidationError);
    expect(() => validateCustomCode("slash/es")).toThrow(ValidationError);
    expect(() => validateCustomCode("emoji😀code")).toThrow(ValidationError);
    // Excluded for being confusable, so they must not be accepted either.
    expect(() => validateCustomCode("c0de")).toThrow(ValidationError);   // zero
    expect(() => validateCustomCode("cIde")).toThrow(ValidationError);   // capital i
    expect(() => validateCustomCode("cLde")).toThrow(ValidationError);   // capital L
    expect(() => validateCustomCode("my-code")).toThrow(ValidationError); // hyphen
  });

  it("rejects reserved words, case-insensitively", () => {
    expect(() => validateCustomCode("api")).toThrow(ValidationError);
    expect(() => validateCustomCode("API")).toThrow(ValidationError);
    expect(() => validateCustomCode("healthz")).toThrow(ValidationError);
    expect(() => validateCustomCode("admin")).toThrow(ValidationError);
  });
});
