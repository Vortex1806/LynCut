import { customAlphabet } from "nanoid";
import { ValidationError } from "../../shared/errors.js";

// 56 characters: excludes 0, 1, O, I, L and lowercase l.
const ALPHABET = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

const DEFAULT_CODE_LENGTH = 7;
const MIN_CODE_LENGTH = 4;
const MAX_CODE_LENGTH = 32;

const RESERVED_CODES = new Set([
  "api",
  "healthz",
  "readyz",
  "auth",
  "admin",
  "login",
  "static",
  "links",
  "dashboard",
  "settings",
  "about",
  "terms",
  "privacy",
]);

const generate = customAlphabet(ALPHABET, DEFAULT_CODE_LENGTH);

const customCodePattern = new RegExp(
  `^[${ALPHABET}]{${MIN_CODE_LENGTH},${MAX_CODE_LENGTH}}$`,
);

export function generateShortCode(): string {
  return generate();
}

export function validateCustomCode(value: string): string {
  if (!customCodePattern.test(value)) {
    throw new ValidationError(
      "Custom code must be 4–32 characters and contain only allowed characters.",
    );
  }

  if (RESERVED_CODES.has(value.toLowerCase())) {
    throw new ValidationError("This custom code is reserved.");
  }

  return value;
}
