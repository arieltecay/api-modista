import express from 'express';
import notificationRoutes from './notification/index.js';
import paymentRoutes from './payment/paymentRoutes.js';
import coursesRoutes from './courses/coursesRoutes.js';

const router = express.Router();

// Use notification routes
router.use('/notifications', notificationRoutes);

// Use payment routes
router.use('/payment', paymentRoutes);

router.use('/courses', coursesRoutes);

export default router;