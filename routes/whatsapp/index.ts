import express from 'express';
import { getWhatsappStatus, initWhatsApp } from '../../controllers/whatsapp/index.js';
import { authenticateToken } from '../../middleware/authMiddleware.js';

const router = express.Router();

// @route   GET /api/whatsapp/status
// @desc    Obtener el estado actual del cliente de WhatsApp
// @access  Private
router.get('/status', authenticateToken, getWhatsappStatus);

// @route   POST /api/whatsapp/init
// @desc    Iniciar la conexión del cliente de WhatsApp y la generación de QR
// @access  Private
router.post('/init', authenticateToken, initWhatsApp);

export default router;
