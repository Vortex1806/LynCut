import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";

import { logger } from "../infra/logger.js";
import { errorHandler, notFoundHandler } from "./error-handler.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createLinkRouter } from "./routes/link.routes.js";
import { createRedirectRouter } from "./routes/redirect.routes.js";

const JSON_BODY_LIMIT = "16kb";

const authRouter = createAuthRouter();
const linksRouter = createLinkRouter();

export function buildServer(): Express {
  const app = express();

  // Behind Cloudflare / a reverse proxy, so rate limiting and logging see
  // the real client IP rather than the proxy's.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet());

  app.use(
    pinoHttp({
      logger,
      genReqId: () => randomUUID(),
      autoLogging: {
        ignore: (req) => {
          const path = req.url ?? "";

          return (
            !path.startsWith("/api/") &&
            path !== "/healthz" &&
            path !== "/readyz"
          );
        },
      },
    }),
  );

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use(createHealthRouter());
  app.use("/api/auth", authRouter);
  app.use("/api/links", linksRouter);

  // Registered last: "/:shortCode" would otherwise shadow everything above.
  app.use(createRedirectRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
