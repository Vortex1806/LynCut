import { z } from "zod";

export const createLinkBodySchema = z.object({
  targetUrl: z.string().min(1).max(2048),
  customCode: z.string().min(4).max(32).optional(),
});

export const updateLinkBodySchema = z.object({
  targetUrl: z.string().min(1).max(2048),
});

export const setActiveBodySchema = z.object({
  isActive: z.boolean(),
});

export const shortCodeParamSchema = z.object({
  shortCode: z.string().min(1).max(32),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const linkResponseSchema = z.object({
  id: z.string(),
  shortCode: z.string(),
  targetUrl: z.string(),
  isActive: z.boolean(),
  visitCount: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const linksListResponseSchema = z.object({
  items: z.array(linkResponseSchema),
  nextCursor: z.string().nullable(),
});
