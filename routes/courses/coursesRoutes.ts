import express, { Router } from 'express';
import {
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getCoursesAdmin,
  getCoursePaidLink
} from '../../controllers/courses/coursesController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router: Router = express.Router();

// Rutas públicas
router.get('/', getCourses);

// Rutas protegidas - requieren autenticación JWT + rol admin
router.post('/', authenticateToken, requireAdmin, createCourse);
router.put('/:id', authenticateToken, requireAdmin, updateCourse);
router.delete('/:id', authenticateToken, requireAdmin, deleteCourse);
router.get('/admin', authenticateToken, requireAdmin, getCoursesAdmin);
router.get('/course-paid/:courseTitle', authenticateToken, requireAdmin, getCoursePaidLink);

export default router;
