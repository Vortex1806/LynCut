import { createHash, randomBytes } from "node:crypto";
import { redis } from "../../infra/redis.js";

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function refreshKey(tokenHash: string): string {
  return `auth:refresh:${tokenHash}`;
}

function sessionsKey(userId: string): string {
  return `auth:user-sessions:${userId}`;
}

const ISSUE_SCRIPT = `
  redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[3])
  redis.call("SADD", KEYS[2], ARGV[2])
  redis.call("EXPIRE", KEYS[2], ARGV[3])
  return 1
`;

const ROTATE_SCRIPT = `
  local userId = redis.call("GET", KEYS[1])
  if not userId then return false end

  local setKey = "auth:user-sessions:" .. userId

  redis.call("DEL", KEYS[1])
  redis.call("SREM", setKey, ARGV[2])
  redis.call("SET", KEYS[2], userId, "EX", ARGV[1])
  redis.call("SADD", setKey, ARGV[3])
  redis.call("EXPIRE", setKey, ARGV[1])

  return userId
`;

const REVOKE_SCRIPT = `
  local userId = redis.call("GET", KEYS[1])
  if not userId then return 0 end

  redis.call("DEL", KEYS[1])
  redis.call("SREM", "auth:user-sessions:" .. userId, ARGV[1])
  return 1
`;

const REVOKE_ALL_SCRIPT = `
  local hashes = redis.call("SMEMBERS", KEYS[1])

  for _, tokenHash in ipairs(hashes) do
    redis.call("DEL", ARGV[1] .. tokenHash)
  end

  redis.call("DEL", KEYS[1])
  return #hashes
`;

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  await redis.eval(
    ISSUE_SCRIPT,
    2,
    refreshKey(tokenHash),
    sessionsKey(userId),
    userId,
    tokenHash,
    String(REFRESH_TOKEN_TTL_SECONDS),
  );

  return token;
}

export async function getRefreshTokenUser(
  token: string,
): Promise<string | null> {
  return redis.get(refreshKey(hashToken(token)));
}

export async function rotateRefreshToken(
  oldToken: string,
): Promise<{ userId: string; refreshToken: string } | null> {
  const newToken = randomBytes(32).toString("base64url");
  const oldHash = hashToken(oldToken);
  const newHash = hashToken(newToken);

  const result: unknown = await redis.eval(
    ROTATE_SCRIPT,
    2,
    refreshKey(oldHash),
    refreshKey(newHash),
    String(REFRESH_TOKEN_TTL_SECONDS),
    oldHash,
    newHash,
  );

  if (typeof result !== "string") return null;

  return {
    userId: result,
    refreshToken: newToken,
  };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  await redis.eval(REVOKE_SCRIPT, 1, refreshKey(tokenHash), tokenHash);
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await redis.eval(REVOKE_ALL_SCRIPT, 1, sessionsKey(userId), "auth:refresh:");
}
