import { Router } from "express";
import {
  signupBodySchema,
  loginBodySchema,
  refreshBodySchema,
  logoutBodySchema,
  authResponseSchema,
  refreshResponseSchema,
} from "../../modules/auth/auth.schema.js";
import { AuthService } from "../../modules/auth/auth.service.js";
import { signAccessToken } from "../../modules/auth/jwt.js";
import { authLimiter, refreshLimiter } from "../middleware/rate-limit.js";

export function createAuthRouter(): Router {
  const router = Router();

  const authService = new AuthService(async (id) => signAccessToken(id));

  router.post("/signup", authLimiter, async (req, res) => {
    const input = signupBodySchema.parse(req.body);
    const result = await authService.signup(input);

    res.status(201).json(authResponseSchema.parse(result));
  });

  router.post("/login", authLimiter, async (req, res) => {
    const input = loginBodySchema.parse(req.body);
    const result = await authService.login(input);

    res.status(200).json(authResponseSchema.parse(result));
  });

  router.post("/refresh", refreshLimiter, async (req, res) => {
    const input = refreshBodySchema.parse(req.body);
    const result = await authService.refresh(input);

    res.status(200).json(refreshResponseSchema.parse(result));
  });

  router.post("/logout", async (req, res) => {
    const input = logoutBodySchema.parse(req.body);
    await authService.logout(input);

    res.status(204).send();
  });

  return router;
}
