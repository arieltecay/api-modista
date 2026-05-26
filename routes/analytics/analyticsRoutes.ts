import { Router } from 'express';
import * as analyticsController from '../../controllers/analytics/analyticsController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

router.post('/track', analyticsController.trackSession);
router.get('/traffic', authenticateToken, requireAdmin, analyticsController.getTrafficStats);
router.post('/import-csv', authenticateToken, requireAdmin, analyticsController.csvUpload.single('file'), analyticsController.importCsv);

export default router;
