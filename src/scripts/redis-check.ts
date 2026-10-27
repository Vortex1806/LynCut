import { redis } from "../infra/redis.js";

async function main() {
  try {
    const pong = await redis.ping();
    console.log("Ping: ", pong);

    await redis.set("lyncut:health-check", "ok", "EX", 20);

    const value = await redis.get("lyncut:health-check");
    console.log("GET:", value);

    if (value !== "ok") {
      throw new Error("Redis read/write verification failed");
    }

    console.log("Redis connection verified successfully");
  } finally {
    await redis.quit();
  }
}

main().catch((error: unknown) => {
  console.error("Redis check failed:", error);
  process.exitCode = 1;
});
