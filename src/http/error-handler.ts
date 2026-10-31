import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../shared/errors.js";
import { logger } from "../infra/logger.js";

/** Runs when no route matched. Express's default would send an HTML page. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: "Resource not found",
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  // Headers already sent: Express must close the connection itself.
  if (res.headersSent) {
    return next(error);
  }

  const log = req.log ?? logger;

  // Zod throws when a request body or response fails its schema.
  if (error instanceof ZodError) {
    log.warn({ err: error }, "Request validation failed");

    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Invalid request data",
    });
  }

  if (error instanceof AppError) {
    const detail = {
      err: error,
      code: error.code,
      statusCode: error.statusCode,
    };

    if (error.statusCode >= 500) {
      log.error(detail, "Application error");
    } else {
      log.warn(detail, "Application error");
    }

    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
  }

  // Errors raised by Express or its middleware already carry a status.
  const status: unknown =
    typeof error === "object" && error !== null && "status" in error
      ? error.status
      : undefined;

  if (typeof status === "number" && status >= 400 && status < 500) {
    log.warn({ err: error, statusCode: status }, "Client request rejected");

    return res.status(status).json({
      error: "BAD_REQUEST",
      message: "The request could not be processed",
    });
  }

  // Unexpected: full detail stays server-side.
  log.error({ err: error }, "Unhandled request error");

  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred.",
  });
};
