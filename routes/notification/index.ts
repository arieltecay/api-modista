import express, { Router } from 'express';
import { sendPurchaseNotification } from '../../controllers/notification/notificationSuccess.js';

const router: Router = express.Router();

router.get('/success', sendPurchaseNotification);

export default router;
