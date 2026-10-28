import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  signupBodySchema,
  loginBodySchema,
  refreshBodySchema,
  logoutBodySchema,
  authResponseSchema,
  refreshResponseSchema,
} from "../../modules/auth/auth.schema.js";

import { AuthService } from "../../modules/auth/auth.service.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  const api = app.withTypeProvider<ZodTypeProvider>();

  const authService = new AuthService(async (userId) =>
    app.jwt.sign({ sub: userId }),
  );

  api.post(
    "/signup",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: signupBodySchema,
        response: { 201: authResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await authService.signup(request.body);
      return reply.code(201).send(result);
    },
  );

  api.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: loginBodySchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await authService.login(request.body);
      return reply.send(result);
    },
  );

  api.post(
    "/refresh",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: refreshBodySchema,
        response: { 200: refreshResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await authService.refresh(request.body);
      return reply.send(result);
    },
  );

  api.post(
    "/logout",
    {
      schema: {
        body: logoutBodySchema,
      },
    },
    async (request, reply) => {
      await authService.logout(request.body);
      return reply.code(204).send();
    },
  );
};

export default authRoutes;
