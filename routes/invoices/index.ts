import { Router } from 'express';
import { createInvoicesController } from '../../controllers/invoices/index.js';
import type { InvoicesServices } from '../../controllers/invoices/types.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';
import { invoiceViewLimiter } from '../../middleware/rateLimiters.js';
import { adminInvoicesServices } from '../../services/invoicing/jobs.js';

export const createInvoicesRouter = (services: InvoicesServices = adminInvoicesServices): Router => {
  const router = Router();
  const controller = createInvoicesController(services);

  // Público: la factura se ve con su token, sin sesión.
  router.get('/public/:token', invoiceViewLimiter, controller.getPublicInvoice);

  router.use(authenticateToken, requireAdmin);
  router.get('/', controller.listInvoices);
  router.get('/:id', controller.getInvoice);
  router.post('/:id/retry', controller.retryInvoice);
  router.post('/:id/resend', controller.resendInvoice);
  router.post('/:id/credit-note', controller.issueCreditNote);
  router.post('/:id/credit-note/retry', controller.retryCreditNote);
  router.post('/:id/credit-note/resend', controller.resendCreditNote);

  return router;
};

export default createInvoicesRouter();
