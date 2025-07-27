import express from 'express';
import notificationRoutes from './notification/index.js';
import paymentRoutes from './payment/paymentRoutes.js';
import coursesRoutes from './courses/coursesRoutes.js';
import emailRoutes from './email/emailRoutes.js'; // Importar las rutas de email

const router = express.Router();

// Use notification routes
router.use('/notifications', notificationRoutes);

// Use payment routes
router.use('/payment', paymentRoutes);

router.use('/courses', coursesRoutes);

router.use('/email', emailRoutes); // Usar las rutas de email

export default router;