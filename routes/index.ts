import express from 'express';
import { rateLimit } from 'express-rate-limit';
const router = express.Router();

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
import carouselRoutes from './carousel/carousel-routes.js';
import faqRoutes from './faq/faqRoutes.js';
import chatRoutes from './chat/chatRoutes.js';
import dashboardRoutes from './dashboard/dashboardRoutes.js';
import analyticsRoutes from './analytics/analyticsRoutes.js';
import landingRoutes from './landing/landingRoutes.js';
import funnelRoutes from './funnel.js';
import uploadRoutes from './upload/index.js';

// Rate limiter para endpoints públicos (lectura)
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiadas solicitudes, intentá de nuevo en 15 minutos' }
});

// Aplicar rate limiting a rutas públicas de lectura
router.use('/courses', publicLimiter, coursesRoutes);
router.use('/faq', publicLimiter, faqRoutes);
router.use('/testimonials', publicLimiter, testimonialsRoute);
router.use('/carousel', publicLimiter, carouselRoutes);
router.use('/tariffs', publicLimiter, tariffRoutes);
router.use('/landings', publicLimiter, landingRoutes);

// Módulos de Venta y Campañas
router.use('/inscriptions', inscriptionsRoutes);
router.use('/workshop-inscriptions', workshopInscriptionsRoutes);
router.use('/funnel', funnelRoutes);

// Módulo de Upload (genérico para todos los recursos)
router.use('/upload', uploadRoutes);

// Módulos de Usuario y Autenticación
router.use('/auth', authRoutes);
router.use('/turnos', turnosRoutes);

// Módulos de Operaciones y Servicios
router.use('/notifications', notificationRoutes);
router.use('/notification', notificationRoutes);
router.use('/payment', paymentRoutes);
router.use('/email', emailRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/chat', chatRoutes);

export default router;
