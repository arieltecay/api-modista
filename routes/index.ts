import express, { Router } from 'express';
import notificationRoutes from './notification/index.js';
import paymentRoutes from './payment/paymentRoutes.js';
import coursesRoutes from './courses/coursesRoutes.js';
import emailRoutes from './email/emailRoutes.js';
import inscriptionsRoutes from './inscriptions/inscriptionsRoutes.js';
import workshopInscriptionsRoutes from './inscriptions/workshopInscriptionsRoutes.js';
import testimonialsRoute from './testimonials/testimonialsRoute.js';
import authRoutes from './auth/authRoutes.js';
import turnosRoutes from './turnos/turnosRoutes.js';
import tariffRoutes from './tariff/tariffRoutes.js';
import uploadRoutes from './upload/index.js';
import carouselRoutes from './carousel/carousel-routes.js';
import faqRoutes from './faq/faqRoutes.js';
import chatRoutes from './chat/chatRoutes.js';

const router: Router = express.Router();

// Use faq routes
router.use('/faq', faqRoutes);

// Use chat routes
router.use('/chat', chatRoutes);

// Use upload routes
router.use('/upload', uploadRoutes);

// Use carousel routes
router.use('/carousel', carouselRoutes);

// Use notification routes
router.use('/notification', notificationRoutes);

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

// Use tariff routes
router.use('/tariffs', tariffRoutes);

export default router;

