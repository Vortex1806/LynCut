import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  BASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).default(5000),
  BLOCK_PRIVATE_ADDRESSES: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  WORKER_NAME: z.string().min(1).max(32).optional(),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().default(3),
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(60),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  for (const issue of result.error.issues) {
    const variable = issue.path.join(".");
    console.error(` - ${variable}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;
