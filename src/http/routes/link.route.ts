import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  createLinkBodySchema,
  updateLinkBodySchema,
  setActiveBodySchema,
  linkResponseSchema,
  linksListResponseSchema,
} from "../../modules/links/link.schema.js";
import { LinksService } from "../../modules/links/link.service.js";


const linksRoutes: FastifyPluginAsync = async (app) => {
  const api = app.withTypeProvider<ZodTypeProvider>();

  const linksService = new LinksService();

  api.post(
    "/",
    {
      preHandler: [app.authenticate],
      schema: {
        body: createLinkBodySchema,
        response: { 201: linkResponseSchema },
      },
    },
    async (request, reply) => {
        linksService.create({
            userId, 
            targetUrl,
            customCode
        })
    },
  );

  // List the authenticated user's links
  api.get(
    "/",
    {
      preHandler: [app.authenticate],
      schema: {
        response: { 200: linksListResponseSchema },
      },
    },
    async (request, reply) => {
      // TODO: Implement
    },
  );

  // Update a link's destination URL
  api.patch(
    "/:shortCode",
    {
      preHandler: [app.authenticate],
      schema: {
        body: updateLinkBodySchema,
        response: { 200: linkResponseSchema },
      },
    },
    async (request, reply) => {
      // TODO: Implement
    },
  );

  // Activate or deactivate a link
  api.patch(
    "/:shortCode/status",
    {
      preHandler: [app.authenticate],
      schema: {
        body: setActiveBodySchema,
        response: { 200: linkResponseSchema },
      },
    },
    async (request, reply) => {
      // TODO: Implement
    },
  );

  // Delete a link
  api.delete(
    "/:shortCode",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      // TODO: Implement
    },
  );

  // Public redirect — no authentication required
  api.get("/:shortCode/redirect", async (request, reply) => {
    // TODO: Implement
  });
};

export default linksRoutes;
