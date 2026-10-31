import Fastify from "fastify";
import { logger } from "../infra/logger.js";
import { randomUUID } from "node:crypto";
import { registerErrorHandler } from "./error-handler.js";
import fastifyJwt from "@fastify/jwt";
import { env } from "../config/env.js";
import authRoutes from "./routes/auth.routes.js";
import healthRoutes from "./routes/health.routes.js";
import rateLimit from "@fastify/rate-limit";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import "fastify";
import type { preHandlerHookHandler } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
  }
}

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => `req-${randomUUID()}`,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      algorithm: "HS256",
      expiresIn: "15m",
      iss: "lyncut",
      aud: "lyncut-api",
    },
    verify: {
      allowedIss: "lyncut",
      allowedAud: "lyncut-api",
      algorithms: ["HS256"],
    },
  });

  app.decorate("authenticate", async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.code(401).send({
        message: "Unauthorized",
      });
    }
  });

  await app.register(healthRoutes);

  await app.register(rateLimit, { global: false });

  await app.register(authRoutes, {
    prefix: "/api/auth",
  });

  return app;
}
