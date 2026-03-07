import { Request, Response } from 'express';
import { whatsappBot } from '../../services/whatsappBotService.js';

/**
 * @description Obtener el estado del servicio de WhatsApp
 * @route GET /api/whatsapp/status
 * @access Private
 */
export const getWhatsappStatus = (req: Request, res: Response) => {
    try {
        const status = {
            isReady: whatsappBot.isReady,
            status: whatsappBot.status,
        };
        res.status(200).json(status);
    } catch (error: any) {
        res.status(500).json({ message: 'Error al obtener el estado de WhatsApp.', error: error.message });
    }
};

/**
 * @description Iniciar el proceso de conexión de WhatsApp
 * @route POST /api/whatsapp/init
 * @access Private
 */
export const initWhatsApp = (req: Request, res: Response) => {
    try {
        // La inicialización es asíncrona, pero no necesitamos esperarla aquí.
        // El frontend recibirá el estado a través de WebSockets.
        whatsappBot.initialize();
        res.status(202).json({ message: 'Solicitud de inicialización de WhatsApp recibida. El estado se actualizará por WebSocket.' });
    } catch (error: any) {
        res.status(500).json({ message: 'Error al iniciar el proceso de WhatsApp.', error: error.message });
    }
};
