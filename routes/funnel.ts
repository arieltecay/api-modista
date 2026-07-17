import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { trackFunnelEvent, getFunnelStats } from '../controllers/funnel/funnelController.js';

const router = Router();

router.post('/event', trackFunnelEvent);
router.get('/stats', authenticateToken, requireAdmin, getFunnelStats);

export default router;