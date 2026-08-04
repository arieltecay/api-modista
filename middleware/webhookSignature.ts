import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../services/logger.js';

/**
 * Verifica la firma HMAC SHA-256 del webhook de MercadoPago.
 *
 * Formato del header `x-signature`: "ts=<timestamp>,v1=<signature>"
 * Manifest: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 *
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 *
 * Si MP_WEBHOOK_SECRET no está configurado, la verificación se omite (solo dev).
 */
export const verifyWebhookSignature = (req: Request, res: Response, next: NextFunction): void => {
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('[Webhook] MP_WEBHOOK_SECRET no configurado, omitiendo verificación de firma');
    next();
    return;
  }

  const xSignature = req.header('x-signature');
  const xRequestId = req.header('x-request-id');

  if (!xSignature || !xRequestId) {
    logger.warn('[Webhook] Faltan headers x-signature o x-request-id', {
      url: req.originalUrl,
      method: req.method,
      headers: req.headers,
      query: req.query,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    });
    res.status(401).json({ error: 'Missing signature headers' });
    return;
  }

  const parts = xSignature.split(',').reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split('=');
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});

  const { ts, v1 } = parts;
  if (!ts || !v1) {
    logger.warn('[Webhook] x-signature mal formado', { xSignature });
    res.status(401).json({ error: 'Malformed signature' });
    return;
  }

  const dataId = req.query['data.id'] || req.query.id;
  if (!dataId || typeof dataId !== 'string') {
    logger.warn('[Webhook] data.id/id faltante en query params');
    res.status(400).json({ error: 'Missing payment ID' });
    return;
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  if (expected !== v1) {
    logger.warn('[Webhook] Firma inválida', {
      expected,
      received: v1,
      url: req.originalUrl,
      method: req.method,
      dataId,
      xRequestId,
      topic: req.query.topic || req.query.type,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  logger.info('[Webhook] Firma válida', { dataId, xRequestId, topic: req.query.topic || req.query.type });
  next();
};
