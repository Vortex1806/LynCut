import { Router } from "express";
import { shortCodeParamSchema } from "../../modules/links/link.schema.js";
import { LinksService } from "../../modules/links/link.service.js";
import { logger } from "../../infra/logger.js";

export function createRedirectRouter(): Router {
  const router = Router();
  const links = new LinksService();

  /**
   * 302, never 301: a permanent redirect is cached by the browser forever,
   * which would hide repeat visits from analytics and make disabling a
   * link ineffective for anyone who had already followed it.
   */
  router.get("/:shortCode", async (req, res) => {
    const { shortCode } = shortCodeParamSchema.parse(req.params);
    const targetUrl = await links.getRedirectTarget(shortCode);

    void links.recordVisit(shortCode).catch((error) => {
      logger.warn({ err: error, shortCode }, "Failed to record link visit");
    });

    res.redirect(302, targetUrl);
  });

  return router;
}
