import { z } from "zod";

export const creatLinkBodySchema = z.object({
  targetUrl: z.url(),
  customCode: z.string().optional(),
});
