import express, { Router } from 'express';
import { sendPurchaseNotification } from '../../controllers/notification/notificationSuccess.js';
import whatsappRoutes from './whatsapp-routes.js';

const router: Router = express.Router();

router.get('/success', sendPurchaseNotification);

// Meta Cloud API Webhook Integration (WhatsApp Business v2.0)
router.use('/whatsapp', whatsappRoutes);

export default router;
