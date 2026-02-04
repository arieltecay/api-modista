import express, { Router } from 'express';
import notificationRoutes from './notification/index.js';
import paymentRoutes from './payment/paymentRoutes.js';
import coursesRoutes from './courses/coursesRoutes.js';
import emailRoutes from './email/emailRoutes.js';
import inscriptionsRoutes from './inscriptions/inscriptionsRoutes.js';
import testimonialsRoute from './testimonials/testimonialsRoute.js';
import authRoutes from './auth/authRoutes.js';
import turnosRoutes from './turnos/turnosRoutes.js';
import workshopInscriptionsRoutes from './inscriptions/workshopInscriptionsRoutes.js';

const router: Router = express.Router();

// Use notification routes
router.use('/notifications', notificationRoutes);

// Use payment routes
router.use('/payment', paymentRoutes);

router.use('/courses', coursesRoutes);

router.use('/testimonials', testimonialsRoute);

router.use('/email', emailRoutes); // Usar las rutas de email

// Use inscriptions routes
router.use('/inscriptions', inscriptionsRoutes);
router.use('/workshop-inscriptions', workshopInscriptionsRoutes);

// Use auth routes
router.use('/auth', authRoutes);

// Use turnos routes
router.use('/turnos', turnosRoutes);

export default router;
