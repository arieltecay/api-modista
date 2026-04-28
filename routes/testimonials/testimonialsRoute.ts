import express, { Router } from 'express';
import {
  getTestimonials,
  getAllTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial
} from '../../controllers/testimonials/index.js';
import { authenticateToken } from '../../middleware/authMiddleware.js';

const router: Router = express.Router();

// Ruta pública para el frontend
router.get('/', getTestimonials);

// Rutas protegidas para el admin
router.get('/all', authenticateToken, getAllTestimonials);
router.post('/', authenticateToken, createTestimonial);
router.put('/:id', authenticateToken, updateTestimonial);
router.delete('/:id', authenticateToken, deleteTestimonial);

export default router;
