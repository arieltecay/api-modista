import { Router } from 'express';
import { getChannels, getOverview, handleReportError } from '../../controllers/AcquisitionReports/index.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

export const createAcquisitionReportsRouter = (): Router => {
  const router = Router();

  router.use(authenticateToken, requireAdmin);
  router.get('/overview', getOverview);
  router.get('/channels', getChannels);
  router.use(handleReportError);

  return router;
};

export default createAcquisitionReportsRouter();
