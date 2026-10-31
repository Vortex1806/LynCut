import { Router } from "express";
import {
  createLinkBodySchema,
  updateLinkBodySchema,
  setActiveBodySchema,
  shortCodeParamSchema,
  listQuerySchema,
  linkResponseSchema,
  linksListResponseSchema,
} from "../../modules/links/link.schema.js";
import { LinksService } from "../../modules/links/link.service.js";
import { requireAuth, userId } from "../middleware/require-auth.js";
import { apiLimiter } from "../middleware/rate-limit.js";
import { idempotent } from "../middleware/idempotency.js";

export function createLinkRouter(): Router {
  const router = Router();
  const links = new LinksService();

  // Every route below needs a signed-in user.
  router.use(requireAuth, apiLimiter);

  router.post("/", idempotent(), async (req, res) => {
    const input = createLinkBodySchema.parse(req.body);

    // The key is included only when defined: exactOptionalPropertyTypes
    // rejects an explicit `undefined` on an optional property.
    const link = await links.create({
      userId: userId(req),
      targetUrl: input.targetUrl,
      ...(input.customCode !== undefined && { customCode: input.customCode }),
    });

    res.status(201).json(linkResponseSchema.parse(link));
  });

  router.get("/", async (req, res) => {
    const query = listQuerySchema.parse(req.query);

    const page = await links.list({
      userId: userId(req),
      limit: query.limit,
      ...(query.cursor !== undefined && { cursor: query.cursor }),
    });

    res.status(200).json(linksListResponseSchema.parse(page));
  });

  router.patch("/:shortCode", async (req, res) => {
    const { shortCode } = shortCodeParamSchema.parse(req.params);
    const { targetUrl } = updateLinkBodySchema.parse(req.body);

    const link = await links.update({
      userId: userId(req),
      shortCode,
      targetUrl,
    });

    res.status(200).json(linkResponseSchema.parse(link));
  });

  router.patch("/:shortCode/status", async (req, res) => {
    const { shortCode } = shortCodeParamSchema.parse(req.params);
    const { isActive } = setActiveBodySchema.parse(req.body);

    const link = await links.setActive({
      userId: userId(req),
      shortCode,
      isActive,
    });

    res.status(200).json(linkResponseSchema.parse(link));
  });

  router.delete("/:shortCode", async (req, res) => {
    const { shortCode } = shortCodeParamSchema.parse(req.params);
    await links.delete({ userId: userId(req), shortCode });

    res.status(204).send();
  });

  return router;
}
