import { Router } from 'express';
import { saveMarketingConsent } from '../../controllers/privacy/marketingConsentController.js';
import { telemetryLimiter } from '../../middleware/rateLimiters.js';

const router = Router();

router.post('/marketing-consent', telemetryLimiter, saveMarketingConsent);

export default router;
