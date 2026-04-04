import express, { Router } from 'express';
import {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  getCoursesAdmin,
  getCoursePaidLink
} from '../../controllers/courses/coursesController.js';
import {
  processMonthlyClosure,
  getMonthlyReports
} from '../../controllers/course/monthly-closure-controller.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router: Router = express.Router();

// Rutas protegidas - requieren autenticación JWT + rol admin
router.post('/', authenticateToken, requireAdmin, createCourse);
router.get('/admin', authenticateToken, requireAdmin, getCoursesAdmin);
router.get('/course-paid/:courseTitle', authenticateToken, requireAdmin, getCoursePaidLink);
router.put('/:id', authenticateToken, requireAdmin, updateCourse);
router.delete('/:id', authenticateToken, requireAdmin, deleteCourse);

// Rutas de Cierre Mensual
router.post('/:id/process-closure', authenticateToken, requireAdmin, processMonthlyClosure);
router.get('/:id/reports', authenticateToken, requireAdmin, getMonthlyReports);

// Rutas públicas (ID dinámico al final)
router.get('/', getCourses);
router.get('/:id', getCourseById);

export default router;
