import { logger } from "../infra/logger.js";
import { beginShutdown } from "./lifecycle.js";

export interface ShutdownTask {
  name: string;
  run: () => Promise<unknown>;
}

interface ShutdownOptions {
  drainMs: number;
  timeoutMs?: number;
}

export function registerShutdown(
  tasks: ShutdownTask[],
  options: ShutdownOptions,
): void {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let shutdownPromise: Promise<void> | undefined;

  async function runShutdown(signal: NodeJS.Signals): Promise<void> {
    logger.info({ signal }, "Graceful shutdown started");

    // Make readiness fail before waiting or closing anything.
    beginShutdown();

    // This timer is a safety net, not a reason to keep Node alive.
    const forceExitTimer = setTimeout(() => {
      logger.fatal({ timeoutMs }, "Shutdown timed out; forcing exit");
      process.exit(1);
    }, timeoutMs);

    forceExitTimer.unref();

    try {
      if (options.drainMs > 0) {
        logger.info(
          { drainMs: options.drainMs },
          "Waiting for load balancer to drain",
        );

        await new Promise<void>((resolve) => {
          setTimeout(resolve, options.drainMs);
        });
      }

      // Execute tasks in order. A failure must not prevent
      // the remaining cleanup tasks from running.
      let failed = false;

      for (const task of tasks) {
        try {
          logger.info({ task: task.name }, "Shutdown task started");
          await task.run();
          logger.info({ task: task.name }, "Shutdown task completed");
        } catch (error) {
          failed = true;
          logger.error({ err: error, task: task.name }, "Shutdown task failed");
        }
      }

      if (failed) {
        process.exitCode = 1;
      } else {
        logger.info("Graceful shutdown completed");
      }
    } catch (error) {
      logger.fatal({ err: error }, "Shutdown sequence failed");
      process.exitCode = 1;
    } finally {
      clearTimeout(forceExitTimer);
    }
  }

  function shutdown(signal: NodeJS.Signals): void {
    // SIGINT and SIGTERM are different events. Guard both.
    if (shutdownPromise) {
      return;
    }

    shutdownPromise = runShutdown(signal);
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
