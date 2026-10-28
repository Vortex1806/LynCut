import argon2 from "argon2";

// Tuned on M-series MacBook Air: ~80ms per hash.
// Re-measure if deploying to different hardware.
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 32_768,
  timeCost: 4,
  parallelism: 1,
};

export async function hash(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verify(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
