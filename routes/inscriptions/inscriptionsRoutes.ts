import express, { Router } from 'express';
import {
  createInscription,
  getInscriptions,
  exportInscriptions,
  updatePaymentStatus,
  countInscriptions,
} from '../../controllers/inscriptions/inscriptionsController.js';

const router: Router = express.Router();

router.post('/', createInscription);
router.get('/', getInscriptions);
router.get('/export', exportInscriptions);
router.get('/count', countInscriptions);
router.patch('/:id/payment-status', updatePaymentStatus);

export default router;
