import express from 'express';
import {
  createInscription,
  getInscriptions,
  exportInscriptions,
  updatePaymentStatus,
} from '../../controllers/inscriptions/inscriptionsController.js';

const router = express.Router();

router.post('/', createInscription);
router.get('/', getInscriptions);
router.get('/export', exportInscriptions);
router.patch('/:id/payment-status', updatePaymentStatus);

export default router;