import { Router } from 'express';
import {
  getWorkshopInscriptions,
  exportWorkshopInscriptions
} from '../../controllers/inscriptions/workshopInscriptionsController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

/**
 * @route   GET /api/workshop-inscriptions/:workshopId
 * @desc    Obtener inscripciones de un taller específico
 * @access  Private (Admin)
 */
router.get('/:workshopId', authenticateToken, requireAdmin, getWorkshopInscriptions);

/**
 * @route   GET /api/workshop-inscriptions/:workshopId/export
 * @desc    Exportar inscripciones de un taller a Excel
 * @access  Private (Admin)
 */
router.get('/:workshopId/export', authenticateToken, requireAdmin, exportWorkshopInscriptions);

export default router;
