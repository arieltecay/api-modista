import { Router } from 'express';
import type { RequestHandler } from 'express';
import { handleAcquisitionError, postBrowserSignal, postEvent, postVisit } from '../../controllers/Acquisition/index.js';
import { acquisitionLimiter } from '../../middleware/rateLimiters.js';

/** The limiter is injectable so tests can prove it guards every public endpoint. */
export const createAcquisitionRouter = (limiter: RequestHandler = acquisitionLimiter): Router => {
  const router = Router();

  router.post('/visits', limiter, postVisit);
  router.post('/events', limiter, postEvent);
  router.post('/signals/browser', limiter, postBrowserSignal);
  router.use(handleAcquisitionError);

  return router;
};

export default createAcquisitionRouter();
