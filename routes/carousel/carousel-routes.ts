import express from 'express';
import CarouselController from '../../controllers/carousel/carousel-controller.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.get('/active', CarouselController.getActiveSlides);

// Protected admin routes
router.get('/', authenticateToken, requireAdmin, CarouselController.getAllSlides);
router.post('/', authenticateToken, requireAdmin, CarouselController.createSlide);
router.patch('/:id', authenticateToken, requireAdmin, CarouselController.updateSlide);
router.delete('/:id', authenticateToken, requireAdmin, CarouselController.deleteSlide);
router.post('/reorder', authenticateToken, requireAdmin, CarouselController.reorderSlides);

export default router;
