import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Inscription from '../../models/Inscription.js';
import { mpPreference, isMercadoPagoConfigured } from '../../services/payments/mpClient.js';
import { logError, logger } from '../../services/logger.js';

interface CreatePreferenceBody {
  inscriptionId: string;
}

const getFrontendUrl = (): string => {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');
  const corsOrigin = process.env.CORS_ORIGIN?.split(',')[0];
  return (corsOrigin || 'http://localhost:5173').replace(/\/+$/, '');
};

const getNotificationUrl = (): string => {
  const base = process.env.MP_NOTIFICATION_URL || process.env.VITE_API_URL || 'http://localhost:3001';
  return `${base.replace(/\/+$/, '')}/api/payment/webhook`;
};

/**
 * POST /api/payment/create-preference
 *
 * Crea una preference de MercadoPago para una inscripción existente.
 * - back_urls apuntan al FRONTEND (no al API).
 * - notification_url apunta al API (/api/payment/webhook).
 * - external_reference = inscriptionId (permite al webhook encontrar la inscripción).
 * - Devuelve init_point (producción) y sandbox_init_point (test).
 */
export const createPreference = async (
  req: Request<{}, {}, CreatePreferenceBody>,
  res: Response
): Promise<void> => {
  const { inscriptionId } = req.body;

  if (!inscriptionId || !Types.ObjectId.isValid(inscriptionId)) {
    res.status(400).json({ error: 'inscriptionId inválido' });
    return;
  }

  if (!isMercadoPagoConfigured()) {
    res.status(503).json({ error: 'MercadoPago no está configurado en el servidor' });
    return;
  }

  try {
    const inscription = await Inscription.findById(inscriptionId);
    if (!inscription) {
      res.status(404).json({ error: 'Inscripción no encontrada' });
      return;
    }

    if (inscription.paymentStatus === 'paid') {
      res.status(400).json({ error: 'Esta inscripción ya está pagada' });
      return;
    }

    const frontendUrl = getFrontendUrl();
    const notificationUrl = getNotificationUrl();

    const preferenceBody = {
      items: [
        {
          id: inscription.courseId,
          title: inscription.courseTitle,
          description: `Inscripción al curso: ${inscription.courseTitle}`,
          unit_price: Number(inscription.coursePrice),
          quantity: 1,
          currency_id: 'ARS',
        },
      ],
      external_reference: inscriptionId,
      back_urls: {
        success: `${frontendUrl}/payment/success?inscription_id=${inscriptionId}`,
        failure: `${frontendUrl}/payment/failure?inscription_id=${inscriptionId}`,
        pending: `${frontendUrl}/payment/pending?inscription_id=${inscriptionId}`,
      },
      auto_return: 'approved' as const,
      notification_url: notificationUrl,
      metadata: {
        inscription_id: inscriptionId,
        course_title: inscription.courseTitle,
      },
    };

    const response = await mpPreference.create({ body: preferenceBody });
    const preferenceId = String(response.id);

    // Persistir preferenceId en la inscripción para tracking
    inscription.mpPreferenceId = preferenceId;
    await inscription.save();

    logger.info(`[createPreference] Preference ${preferenceId} creada para inscripción ${inscriptionId}`);

    res.json({
      preferenceId,
      initPoint: response.init_point,
      sandboxInitPoint: response.sandbox_init_point,
    });
  } catch (error) {
    logError('createPreference', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create preference' });
  }
};
