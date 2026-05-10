import { Request, Response } from 'express';
import ConversationMessage from '../../models/ConversationMessage.js';
import { sendWhatsAppMessage } from '../../services/whatsapp-official-service.js';

export const getChats = async (req: Request, res: Response) => {
  try {
    const chats = await ConversationMessage.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { platform: '$platform', platform_id: '$platform_id' },
          lastMessage: { $first: '$body' },
          lastTimestamp: { $first: '$timestamp' }
        }
      },
      { $sort: { lastTimestamp: -1 } }
    ]);
    res.json(chats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getMessagesByPlatform = async (req: Request, res: Response) => {
  try {
    const { platform, platform_id } = req.params;
    const messages = await ConversationMessage.find({ platform, platform_id }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { platform, platform_id } = req.params;
    const { body } = req.body;

    let sent = true;
    
    // Si la plataforma es WhatsApp, enviamos el mensaje real a través de la API oficial
    if (platform === 'whatsapp') {
      console.log(`[Admin Hub] Enviando respuesta manual a ${platform_id}...`);
      sent = await sendWhatsAppMessage(platform_id as string, body);
    }

    if (sent) {
      const message = await ConversationMessage.create({ 
        platform, 
        platform_id, 
        body, 
        direction: 'outbound', 
        status: 'sent' 
      });
      res.status(201).json(message);
    } else {
      res.status(500).json({ error: 'No se pudo enviar el mensaje por WhatsApp a través de la API de Meta' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
