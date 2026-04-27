import { Router } from 'express';
import * as faqController from '../../controllers/faq/faqController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

// Public routes
router.get('/active', faqController.getActiveFAQs);

// Protected routes (Admin)
router.get('/', authenticateToken, faqController.getAllFAQs);
router.post('/', authenticateToken, faqController.createFAQ);
router.put('/:id', authenticateToken, faqController.updateFAQ);
router.delete('/:id', authenticateToken, faqController.deleteFAQ);

export default router;
