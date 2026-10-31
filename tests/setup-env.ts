/**
 * Loaded before any test module. Everything here must be set before
 * src/config/env.ts is imported, because that file parses and exits on
 * failure at import time.
 *
 * Assigned unconditionally, not with ??=: a test run must not inherit
 * whatever happens to be in the developer's shell, or it passes on one
 * machine and fails on another.
 */
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? "silent";
process.env.JWT_SECRET = "test-secret-at-least-32-characters-long!!";
process.env.BASE_URL = "http://localhost:3000";
process.env.SHUTDOWN_DRAIN_MS = "0";

// A separate database and a separate Redis db index, so a test run can
// never truncate or flush the data you are developing against.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://app:shubhvora@localhost:5432/lyncut_test";
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

// SSRF checks are the most security-critical code in the project, so the
// tests must exercise them rather than the development bypass.
process.env.BLOCK_PRIVATE_ADDRESSES = "true";

// The limiter is verified by its own test with a fixed client IP. Everywhere
// else it would just throttle the suite, since every request comes from
// 127.0.0.1 and each createUser() is a signup.
process.env.RATE_LIMIT_AUTH_MAX = "10000";
process.env.RATE_LIMIT_REFRESH_MAX = "10000";
process.env.RATE_LIMIT_API_MAX = "10000";
