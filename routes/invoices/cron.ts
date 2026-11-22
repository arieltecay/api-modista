import { Router } from 'express';
import { requireCronSecret } from '../../middleware/cronSecret.js';
import { logger } from '../../services/logger.js';
import { runInvoiceRetryJob } from '../../services/invoicing/jobs.js';

/** Cron (Vercel): termina las facturas que quedaron pendientes porque ARCA no respondió y las envía por mail. */
export const createInvoicesCronRouter = (run: () => Promise<object> = runInvoiceRetryJob): Router => {
  const router = Router();

  router.get('/', requireCronSecret, async (_req, res) => {
    try {
      res.json({ success: true, ...(await run()) });
    } catch (error) {
      logger.error('[Cron] Error reintentando facturas:', error);
      res.status(500).json({ success: false, message: 'Error reintentando facturas' });
    }
  });

  return router;
};

export default createInvoicesCronRouter();
