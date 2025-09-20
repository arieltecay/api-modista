import express, { Router } from 'express';
import {
  getCourses,
  getTestimonials,
  createCourse,
  updateCourse,
  deleteCourse,
  getCoursesAdmin
} from '../../controllers/courses/coursesController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router: Router = express.Router();

// Rutas públicas
router.get('/', getCourses);
router.get('/testimonials', getTestimonials);

// Rutas protegidas - requieren autenticación JWT + rol admin
router.post('/', authenticateToken, requireAdmin, createCourse);
router.put('/:id', authenticateToken, requireAdmin, updateCourse);
router.delete('/:id', authenticateToken, requireAdmin, deleteCourse);
router.get('/admin', authenticateToken, requireAdmin, getCoursesAdmin);

export default router;
