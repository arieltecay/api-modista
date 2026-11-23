import { Router } from 'express';
import { couponsController } from '../../controllers/Coupons/index.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';
import { couponValidateLimiter } from '../../middleware/rateLimiters.js';

export const createCouponsRouter = (): Router => {
  const router = Router();

  // Público: el checkout pregunta por el precio final de un código.
  router.post('/validate', couponValidateLimiter, couponsController.validateCoupon);

  router.use(authenticateToken, requireAdmin);
  router.get('/summary', couponsController.getSummary);
  router.get('/', couponsController.listCoupons);
  router.post('/', couponsController.createCoupon);
  router.get('/:id', couponsController.getCoupon);
  router.patch('/:id', couponsController.updateCoupon);

  return router;
};

export default createCouponsRouter();
