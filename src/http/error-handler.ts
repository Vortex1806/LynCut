import type { FastifyError } from "fastify";
import { AppError } from "../shared/errors.js";
import type { AppInstance } from "./app-types.js";

export function registerErrorHandler(app: AppInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        error: "ValidationError",
        message: "Invalid request data",
      });
    }

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

    const statusCode = error.statusCode;

    if (
      typeof statusCode === "number" &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      request.log.warn({ err: error, statusCode }, "Client request rejected");

      if (statusCode === 429) {
        return reply.code(429).send({
          error: "TooManyRequests",
          message: "Too many requests. Please try again later.",
        });
      }

      return reply.code(statusCode).send({
        error: error.code ?? "ClientError",
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
