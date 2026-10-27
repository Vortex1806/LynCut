import { AppError } from "../shared/errors.js";
import type { AppInstance } from "./app-types.js";

export function registerErrorHandler(app: AppInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const log = {
        err: error,
        code: error.code,
        statusCode: error.statusCode,
      };

      // Server-side failures deserve error-level logging.
      if (error.statusCode >= 500) {
        request.log.error(log, "Application error");
      } else {
        request.log.warn(log, "Application error");
      }

      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    // Unexpected errors: detailed logs stay server-side.
    request.log.error({ err: error }, "Unhandled request error");

    return reply.code(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    });
  });
}
