import { Router } from 'express';
import * as dashboardController from '../../controllers/dashboard/dashboardController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

// Todas las rutas de dashboard requieren admin
router.use(authenticateToken, requireAdmin);

router.get('/stats', dashboardController.getGeneralStats);
router.get('/performance', dashboardController.getCoursePerformance);
router.get('/meta-whatsapp', dashboardController.getMetaWhatsAppStats);
router.get('/unread-messages', dashboardController.getUnreadMessagesCount);

export default router;
