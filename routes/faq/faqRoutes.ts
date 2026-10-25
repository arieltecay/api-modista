import { Router } from 'express';
import * as faqController from '../../controllers/faq/faqController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';
import { publicCache } from '../../middleware/publicCache.js';

const router = Router();

// Public routes (GET puro, cacheable en borde)
router.get('/active', publicCache(), faqController.getActiveFAQs);

// Protected routes (Admin)
router.get('/', authenticateToken, faqController.getAllFAQs);
router.post('/', authenticateToken, faqController.createFAQ);
router.put('/:id', authenticateToken, faqController.updateFAQ);
router.delete('/:id', authenticateToken, faqController.deleteFAQ);

export default router;
