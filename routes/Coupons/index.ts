import { Router } from 'express';
import { couponsController } from '../../controllers/Coupons/index.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';
import { couponAvailabilityLimiter, couponValidateLimiter } from '../../middleware/rateLimiters.js';

export const createCouponsRouter = (): Router => {
  const router = Router();

  // Público: el checkout pregunta por el precio final de un código.
  router.post('/validate', couponValidateLimiter, couponsController.validateCoupon);
  // Público: ¿el formulario de este curso muestra el campo de cupón? (sí/no, sin códigos)
  router.get('/availability', couponAvailabilityLimiter, couponsController.getAvailability);

  router.use(authenticateToken, requireAdmin);
  router.get('/summary', couponsController.getSummary);
  router.get('/', couponsController.listCoupons);
  router.post('/', couponsController.createCoupon);
  router.get('/:id', couponsController.getCoupon);
  router.patch('/:id', couponsController.updateCoupon);

  return router;
};

export default createCouponsRouter();
