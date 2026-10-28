import { z } from "zod";

export const signupBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(128),
});

export const loginBodySchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

export const logoutBodySchema = refreshBodySchema;

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

export const authResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
