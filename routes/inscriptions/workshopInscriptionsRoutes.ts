import { Router } from 'express';
import {
  getWorkshopInscriptions,
  exportWorkshopInscriptions,
  getWorkshopDetails,
  getAvailableTurnosForReschedule,
  updateInscriptionSchedule
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

/**
 * @route   GET /api/workshop-inscriptions/inscription/:inscriptionId/available-turnos
 * @desc    Obtener turnos disponibles para reagendar (valida cupos en servidor)
 * @access  Private (Admin)
 */
router.get('/inscription/:inscriptionId/available-turnos', authenticateToken, requireAdmin, getAvailableTurnosForReschedule);

/**
 * @route   PUT /api/workshop-inscriptions/:inscriptionId/schedule
 * @desc    Actualizar el turno de una inscripción
 * @access  Private (Admin)
 */
router.put('/:inscriptionId/schedule', authenticateToken, requireAdmin, updateInscriptionSchedule);

export default router;
