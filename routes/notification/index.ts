import express, { Router } from 'express';
import { sendPurchaseNotification } from '../../controllers/notification/notificationSuccess.js';
import whatsappRoutes from './whatsapp-routes.js';
import instagramRoutes from './instagram-routes.js';

const router: Router = express.Router();

router.get('/success', sendPurchaseNotification);

// Meta Cloud API Webhook Integration
router.use('/whatsapp', whatsappRoutes);
router.use('/instagram', instagramRoutes);

export default router;
