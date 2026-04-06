import { z } from 'zod';

export const createSlideSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  imageUrl: z.string().url(),
  imagePublicId: z.string().min(1),
  link: z.string().min(1),
  buttonText: z.string().optional(),
  order: z.number().int().optional(),
  isActive: z.boolean().optional(),
  publishAt: z.string().datetime().optional().nullable(),
  expireAt: z.string().datetime().optional().nullable(),
});

export const updateSlideSchema = createSlideSchema.partial();

export const reorderSlidesSchema = z.array(z.object({
  slideId: z.string().min(1),
  order: z.number().int()
}));

export type CreateSlideBody = z.infer<typeof createSlideSchema>;
export type UpdateSlideBody = z.infer<typeof updateSlideSchema>;
export type ReorderSlidesBody = z.infer<typeof reorderSlidesSchema>;
