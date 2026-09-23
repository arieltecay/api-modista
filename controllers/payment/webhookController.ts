import { Request, Response } from 'express';
import { mpPayment, isMercadoPagoConfigured } from '../../services/payments/mpClient.js';
import { processWebhookPayment } from '../../services/payments/webhookProcessor.js';
import { logger } from '../../services/logger.js';

/**
 * Webhook de notificaciones de MercadoPago.
 *
 * - Procesa ANTES de responder: en Vercel serverless la función se congela
 *   al responder, por lo que el patrón "200 inmediato + background" perdía
 *   pagos (nunca se procesaban). MP tolera respuestas de varios segundos
 *   y reintenta con backoff si recibe error, por lo que procesar inline es seguro.
 * - La idempotencia (paymentHistory + events Meta) evita doble procesamiento
 *   si MP reintenta.
 * - Soporta webhook v1 (?topic=payment&id=) y v2 (?type=payment&data.id=).
 *   Solo actuamos en type=payment (ignora merchant_order, test, etc).
 */
export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const topic = query.topic;
    const type = query.type;

    // Solo procesar pagos — siempre 200 (no es un error, aplica también a merchant_order)
    if (topic !== 'payment' && type !== 'payment') {
      logger.info(`[Webhook] Ignorando topic/type: ${topic || type || 'undefined'}`);
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    const dataId = query['data.id'] || query.id;
    if (!dataId) {
      logger.warn('[Webhook] data.id faltante en query params', { query });
      // 200: un retry no va a cambiar el resultado (payload mal formado)
      res.status(200).json({ received: true, error: 'missing data.id' });
      return;
    }

    if (!isMercadoPagoConfigured()) {
      logger.error('[Webhook] MERCADO_PAGO_ACCESS_TOKEN no configurado, no se puede consultar el pago');
      // 503: transitorio (config), MP reintenta → el pago no se pierde
      res.status(503).json({ received: false, error: 'MP not configured' });
      return;
    }

    // Consultamos el pago a MP (fuente de verdad)
    const paymentId = Number(dataId);
    if (!Number.isFinite(paymentId)) {
      logger.warn(`[Webhook] data.id no es numérico: ${dataId}`);
      res.status(200).json({ received: true, error: 'invalid data.id' });
      return;
    }

    const mpPaymentData = await mpPayment.get({ id: paymentId });
    await processWebhookPayment(mpPaymentData as any);

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('[Webhook] Error procesando notificación', {
      error: error instanceof Error ? error.message : String(error),
      query: req.query,
    });
    // 500 transitorio: MP reintenta → recupera el pago sin intervención manual.
    // La idempotencia del procesador absorbe el procesamiento repetido.
    if (!res.headersSent) {
      res.status(500).json({ received: false });
    }
  }
};
