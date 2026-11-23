import { z } from 'zod';

const instructionFields = {
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(10_000),
  order: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};
const keywords = z.array(z.string().trim().min(3).max(80)).max(20);

/** Instagram rechaza textos de más de 1000 bytes; 900 caracteres es el mismo tope de las respuestas generadas. */
export const INSTAGRAM_FIXED_RESPONSE_MAX_CHARS = 900;
export const INSTAGRAM_FIXED_RESPONSE_MAX_BYTES = 1000;
const responseMode = z.enum(['gemini', 'fixed']);
// Cuenta code points (un emoji simple = 1), no unidades UTF-16 como `.max()`.
const fixedResponse = z.string().trim()
  .refine(text => [...text].length <= INSTAGRAM_FIXED_RESPONSE_MAX_CHARS && Buffer.byteLength(text, 'utf8') <= INSTAGRAM_FIXED_RESPONSE_MAX_BYTES);

export const instructionInputSchema = z.object({
  ...instructionFields,
  instagramAutoReply: z.boolean().default(false),
  instagramKeywords: keywords.default([]),
  instagramEnrollmentLookup: z.boolean().default(false),
  instagramCommentReply: z.boolean().default(false),
  instagramResponseMode: responseMode.default('gemini'),
  instagramFixedResponse: fixedResponse.optional(),
});

// Sin defaults: una actualización parcial no debe reiniciar lo que omite.
export const instructionUpdateSchema = z.object({
  ...instructionFields,
  instagramAutoReply: z.boolean(),
  instagramKeywords: keywords,
  instagramEnrollmentLookup: z.boolean(),
  instagramCommentReply: z.boolean(),
  instagramResponseMode: responseMode,
  instagramFixedResponse: fixedResponse,
}).partial();

interface InstagramModeFields {
  instagramResponseMode?: string;
  instagramFixedResponse?: string;
  instagramEnrollmentLookup?: boolean;
}

/**
 * Combinaciones que el modo fijo no admite. Se evalúa sobre la regla completa (guardada + cambios),
 * porque una actualización parcial puede romperla tocando un solo campo.
 */
export const instagramModeError = (rule: InstagramModeFields): string | undefined => {
  if (rule.instagramResponseMode !== 'fixed') return undefined;
  if (!rule.instagramFixedResponse?.trim()) return 'La respuesta fija necesita un mensaje';
  if (rule.instagramEnrollmentLookup) return 'La respuesta fija no puede consultar inscripciones';
  return undefined;
};
