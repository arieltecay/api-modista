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
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;
import { whatsappBot } from '../services/whatsappBotService.js';

const router: Router = express.Router();

// WhatsApp Status
router.get('/whatsapp/status', (req, res) => {
  res.json({
    connected: whatsappBot.isReady,
    status: whatsappBot.status, // Return detailed status
    qr: whatsappBot.lastQr
  });
});

router.post('/whatsapp/restart', async (req, res) => {
  try {
    // Force reset status to allow re-initialization
    whatsappBot.status = 'disconnected'; 
    await whatsappBot.initialize(); // Re-inicializar
    res.json({ success: true, message: 'Reiniciando servicio de WhatsApp...' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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

// Use tariff routes
router.use('/tariffs', tariffRoutes);

export default router;
