import { Request, Response } from 'express';
import { mpPayment, isMercadoPagoConfigured } from '../../services/payments/mpClient.js';
import { processWebhookPayment } from '../../services/payments/webhookProcessor.js';
import { logger } from '../../services/logger.js';

/**
 * Webhook de notificaciones de MercadoPago.
 *
 * - Responde 200 INMEDIATAMENTE (MP espera respuesta rápida y reintenta si tardamos).
 * - Procesa el pago en background.
 * - Soporta webhook v1 (?topic=payment&id=) y v2 (?type=payment&data.id=).
 *   Solo actuamos en type=payment (ignora merchant_order, test, etc).
 */
export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ received: true });

  try {
    const query = req.query as Record<string, string | undefined>;
    const topic = query.topic;
    const type = query.type;

    // Solo procesar pagos
    if (topic !== 'payment' && type !== 'payment') {
      logger.info(`[Webhook] Ignorando topic/type: ${topic || type || 'undefined'}`);
      return;
    }

    const dataId = query['data.id'] || query.id;
    if (!dataId) {
      logger.warn('[Webhook] data.id faltante en query params', { query });
      return;
    }

    if (!isMercadoPagoConfigured()) {
      logger.error('[Webhook] MERCADO_PAGO_ACCESS_TOKEN no configurado, no se puede consultar el pago');
      return;
    }

    // Consultamos el pago a MP (fuente de verdad)
    const paymentId = Number(dataId);
    if (!Number.isFinite(paymentId)) {
      logger.warn(`[Webhook] data.id no es numérico: ${dataId}`);
      return;
    }

    const mpPaymentData = await mpPayment.get({ id: paymentId });
    await processWebhookPayment(mpPaymentData as any);
  } catch (error) {
    logger.error('[Webhook] Error procesando notificación', {
      error: error instanceof Error ? error.message : String(error),
      query: req.query,
    });
  }
};
