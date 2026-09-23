import { Router } from 'express';
import { processDlqBatch } from '../services/meta-capi-service.js';
import { logger } from '../services/logger.js';

const router = Router();

/**
 * Cron: procesa la DLQ de eventos de Meta CAPI.
 *
 * En Vercel serverless el setInterval del server.js NO corre (el runtime no es
 * persistente), por lo que los eventos CAPI fallidos quedaban pendientes para
 * siempre. Este endpoint es invocado por Vercel Cron (ver vercel.json > crons)
 * cada 5 minutos y procesa los reintentos.
 *
 * Protegido con CRON_SECRET (Vercel lo inyecta como `Authorization: Bearer <secret>`
 * cuando está configurado en las env vars del proyecto).
 */
router.get('/meta-dlq', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;

  // Si no hay CRON_SECRET configurado, este endpoint no debe operar en producción.
  if (!cronSecret) {
    return res.status(503).json({ success: false, message: 'CRON_SECRET no configurado' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }

  try {
    const result = await processDlqBatch(50);
    return res.json({ success: true, ...result });
  } catch (error) {
    logger.error('[Cron] Error procesando DLQ de Meta:', error);
    return res.status(500).json({ success: false, message: 'Error procesando DLQ' });
  }
});

export default router;
