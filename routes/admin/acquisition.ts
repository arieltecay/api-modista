import { Router } from 'express';
import {
  getChannels,
  getFunnel,
  getJourney,
  getJourneyList,
  getLive,
  getOverview,
  getQuality,
  handleReportError,
} from '../../controllers/AcquisitionReports/index.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

export const createAcquisitionReportsRouter = (): Router => {
  const router = Router();

  router.use(authenticateToken, requireAdmin);
  router.get('/overview', getOverview);
  router.get('/channels', getChannels);
  router.get('/funnel', getFunnel);
  router.get('/live', getLive);
  router.get('/journeys', getJourneyList);
  router.get('/journeys/:visitId', getJourney);
  router.get('/quality', getQuality);
  router.use(handleReportError);

  return router;
};

export default createAcquisitionReportsRouter();
