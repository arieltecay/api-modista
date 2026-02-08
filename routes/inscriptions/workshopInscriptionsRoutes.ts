import { Router } from 'express';
import {
  getWorkshopInscriptions,
  exportWorkshopInscriptions,
  getWorkshopDetails
} from '../../controllers/inscriptions/workshopInscriptionsController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

/**
 * @route   GET /api/workshop-inscriptions/:workshopId
 * @desc    Obtener inscripciones de un taller específico (paginado)
 * @access  Private (Admin)
 */
router.get('/:workshopId', authenticateToken, requireAdmin, getWorkshopInscriptions);

/**
 * @route   GET /api/workshop-inscriptions/:workshopId/details
 * @desc    Obtener datos detallados y agrupados del taller para la página de detalles
 * @access  Private (Admin)
 */
router.get('/:workshopId/details', authenticateToken, requireAdmin, getWorkshopDetails);

/**
 * @route   GET /api/workshop-inscriptions/:workshopId/export
 * @desc    Exportar inscripciones de un taller a Excel
 * @access  Private (Admin)
 */
router.get('/:workshopId/export', authenticateToken, requireAdmin, exportWorkshopInscriptions);

export default router;
