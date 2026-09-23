import express, { Router } from 'express';
import {
  createInscription,
  createLandingInscription,
  getInscriptions,
  exportInscriptions,
  updatePaymentStatus,
  countInscriptions,
  updateDeposit,
  addPayment,
  getPaymentHistory,
  deletePayment,
} from '../../controllers/inscriptions/inscriptionsController.js';
import { triggerInscriptionsRecovery } from '../../controllers/inscriptions/recoveryController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';
import { inscriptionLimiter } from '../../middleware/rateLimiters.js';

const router: Router = express.Router();

// Rutas públicas - cualquier usuario puede inscribirse
// Protegidas con rate limit: un Lead/Inscription falso ensucia la optimización de Meta Ads.
router.post('/', inscriptionLimiter, createInscription);
router.post('/landing', inscriptionLimiter, createLandingInscription);

// Ruta para disparar la recuperación (protegida para evitar spam)
router.post('/run-recovery', authenticateToken, requireAdmin, triggerInscriptionsRecovery);

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
