import express from 'express';
import {
  createInscription,
  getInscriptions,
  exportInscriptions,
} from '../../controllers/inscriptions/inscriptionsController.js';

const router = express.Router();

router.post('/', createInscription);
router.get('/', getInscriptions);
router.get('/export', exportInscriptions);

export default router;