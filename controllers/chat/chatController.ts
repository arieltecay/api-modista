import { Request, Response } from 'express';
import ConversationMessage from '../../models/ConversationMessage.js';
import { sendWhatsAppMessage } from '../../services/whatsapp-official-service.js';
import { sendInstagramMessage } from '../../services/instagram/instagram-official-service.js';

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
    
    // Al obtener los mensajes de un chat, marcamos los mensajes entrantes como leídos
    await ConversationMessage.updateMany(
      { platform, platform_id, direction: 'inbound', isAdminRead: false },
      { $set: { isAdminRead: true } }
    );

    const messages = await ConversationMessage.find({ platform, platform_id }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { platform, platform_id } = req.params;
    await ConversationMessage.updateMany(
      { platform, platform_id, direction: 'inbound', isAdminRead: false },
      { $set: { isAdminRead: true } }
    );
    res.json({ message: 'Mensajes marcados como leídos' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { platform, platform_id } = req.params;
    const { body } = req.body;

    let sent = true;
    
    if (platform === 'whatsapp') {
      console.log(`[Admin Hub] Enviando respuesta manual por WhatsApp a ${platform_id}...`);
      sent = await sendWhatsAppMessage(platform_id as string, body);
    } else if (platform === 'instagram') {
      console.log(`[Admin Hub] Enviando respuesta manual por Instagram a ${platform_id}...`);
      sent = await sendInstagramMessage(platform_id as string, body);
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
      res.status(500).json({ error: `No se pudo enviar el mensaje por ${platform}` });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteMessage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deletedMessage = await ConversationMessage.findByIdAndDelete(id);
    
    if (!deletedMessage) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    
    res.json({ message: 'Mensaje eliminado correctamente' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const clearChatHistory = async (req: Request, res: Response) => {
  try {
    const { platform, platform_id } = req.params;
    await ConversationMessage.deleteMany({ platform, platform_id });
    
    res.json({ message: 'Historial de chat eliminado correctamente' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
