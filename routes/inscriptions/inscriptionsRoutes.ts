import express, { Router } from 'express';
import {
  createInscription,
  getInscriptions,
  exportInscriptions,
  updatePaymentStatus,
  countInscriptions,
  updateDeposit,
  addPayment,
  getPaymentHistory,
  deletePayment, // <--- Añadido
} from '../../controllers/inscriptions/inscriptionsController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router: Router = express.Router();

// Ruta pública - cualquier usuario puede inscribirse
router.post('/', createInscription);

// Rutas protegidas - requieren autenticación JWT + rol admin
router.get('/', authenticateToken, requireAdmin, getInscriptions);
router.get('/export', authenticateToken, requireAdmin, exportInscriptions);
router.get('/count', authenticateToken, requireAdmin, countInscriptions);
router.patch('/:id/payment-status', authenticateToken, requireAdmin, updatePaymentStatus);
router.patch('/:id/deposit', authenticateToken, requireAdmin, updateDeposit);

// Nuevas rutas para historial de pagos (Aditivas)
router.post('/:id/payments', authenticateToken, requireAdmin, addPayment);
router.get('/:id/payments', authenticateToken, requireAdmin, getPaymentHistory);
router.delete('/:id/payments/:paymentId', authenticateToken, requireAdmin, deletePayment); // <--- Añadido

export default router;
