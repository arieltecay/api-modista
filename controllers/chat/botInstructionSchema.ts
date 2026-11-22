import { z } from 'zod';

const instructionFields = {
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(10_000),
  order: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};
const keywords = z.array(z.string().trim().min(3).max(80)).max(20);

export const instructionInputSchema = z.object({
  ...instructionFields,
  instagramAutoReply: z.boolean().default(false),
  instagramKeywords: keywords.default([]),
  instagramEnrollmentLookup: z.boolean().default(false),
  instagramCommentReply: z.boolean().default(false),
});

// Sin defaults: una actualización parcial no debe reiniciar lo que omite.
export const instructionUpdateSchema = z.object({
  ...instructionFields,
  instagramAutoReply: z.boolean(),
  instagramKeywords: keywords,
  instagramEnrollmentLookup: z.boolean(),
  instagramCommentReply: z.boolean(),
}).partial();
