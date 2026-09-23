import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { trackFunnelEvent, getFunnelStats } from '../controllers/funnel/funnelController.js';
import { telemetryLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.post('/event', telemetryLimiter, trackFunnelEvent);
router.get('/stats', authenticateToken, requireAdmin, getFunnelStats);

export default router;