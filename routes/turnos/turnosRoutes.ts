import { Router } from 'express';
import {
    getTurnosByCourse,
    createTurno,
    updateTurno,
    deleteTurno
} from '../../controllers/turnos/turnosController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

/**
 * @route   GET /api/turnos/course/:courseId
 * @desc    Obtener turnos por curso
 * @access  Public
 */
router.get('/course/:courseId', getTurnosByCourse);

/**
 * @route   POST /api/turnos
 * @desc    Crear un nuevo turno
 * @access  Private (Admin)
 */
router.post('/', authenticateToken, requireAdmin, createTurno);

/**
 * @route   PATCH /api/turnos/:id
 * @desc    Actualizar un turno
 * @access  Private (Admin)
 */
router.patch('/:id', authenticateToken, requireAdmin, updateTurno);

/**
 * @route   DELETE /api/turnos/:id
 * @desc    Eliminar un turno
 * @access  Private (Admin)
 */
router.delete('/:id', authenticateToken, requireAdmin, deleteTurno);

export default router;
