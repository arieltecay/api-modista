import { Router } from 'express';
import { trackFunnelStep } from '../controllers/funnel/funnelController.js';

const router = Router();
router.post('/track', trackFunnelStep);

export default router;
