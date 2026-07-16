import express from 'express';
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

// Módulos de Venta y Campañas
router.use('/landings', landingRoutes);
router.use('/inscriptions', inscriptionsRoutes);
router.use('/workshop-inscriptions', workshopInscriptionsRoutes);
router.use('/funnel', funnelRoutes);

// Módulos de Contenido
router.use('/courses', coursesRoutes);
router.use('/faq', faqRoutes);
router.use('/testimonials', testimonialsRoute);
router.use('/carousel', carouselRoutes);

// Módulos de Usuario y Autenticación
router.use('/auth', authRoutes);
router.use('/turnos', turnosRoutes);
router.use('/tariffs', tariffRoutes);

// Módulos de Operaciones y Servicios
router.use('/notifications', notificationRoutes);
router.use('/notification', notificationRoutes); // Alias para compatibilidad con Meta Webhook y consistencia interna
router.use('/payment', paymentRoutes);
router.use('/email', emailRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/chat', chatRoutes);

export default router;
