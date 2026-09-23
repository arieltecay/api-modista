import { Response } from 'express';

/**
 * Honeypot anti-bots para los endpoints públicos de inscripción.
 *
 * El front renderiza un campo `website` invisible para humanos (los bots lo
 * completan). Si llega con contenido, respondemos un 201 fake con shape válido:
 * el bot cree que pasó, pero no se crea inscripción, no se genera preference
 * de MercadoPago y NO se disparan eventos a Meta (protege la señal de Ads).
 */
export const HONEYPOT_FIELD = 'website';

export const isHoneypotTriggered = (body: unknown): boolean => {
  if (!body || typeof body !== 'object') return false;
  const value = (body as Record<string, unknown>)[HONEYPOT_FIELD];
  return typeof value === 'string' && value.trim().length > 0;
};

export const respondFakeSuccess = (res: Response): Response =>
  res.status(201).json({
    success: true,
    data: { honeypot: true },
    mpPaymentLink: null,
    mpInitPoint: null,
    sandboxInitPoint: null,
    mpPreferenceId: null,
  });
