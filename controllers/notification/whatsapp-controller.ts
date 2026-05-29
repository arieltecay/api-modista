import crypto from 'crypto';
import { Request, Response } from 'express';
import { MetaWhatsAppWebhookPayload } from '../../types/whatsapp-official.js';
import { generateAIResponse } from '../../services/gemini-service.js';
import { sendWhatsAppMessage } from '../../services/whatsapp-official-service.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { logger } from '../../services/logger.js';
import { 
  handlePurchaseIntent, 
  handlePaymentConfirmation, 
  handleCvuCopy, 
  handleAliasCopy,
  isPurchaseIntent,
  isPaymentConfirmation 
} from '../../services/whatsapp/whatsapp-bot-service.js';

export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      logger.info('Webhook de WhatsApp verificado con éxito');
      res.status(200).send(challenge);
    } else {
      logger.warn('Intento de verificación de webhook fallido: Token inválido');
      res.sendStatus(403);
    }
  }
};

export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    
    if (process.env.META_APP_SECRET && signature) {
      const elements = signature.split('=');
      const signatureHash = elements[1];
      const expectedHash = crypto
        .createHmac('sha256', process.env.META_APP_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signatureHash !== expectedHash) {
        logger.warn('⚠️ Validación de firma HMAC fallida en Webhook de WhatsApp');
      }
    }

    const body: MetaWhatsAppWebhookPayload = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          const value = change.value;
          
          if (value.messages) {
            for (const message of value.messages) {
              const from = message.from;
              
              if (message.type === 'button' && message.button) {
                const buttonText = message.button.text;
                
                if (buttonText === 'Copiar CVU') {
                  await handleCvuCopy(from);
                  continue;
                }
                
                if (buttonText === 'Copiar Alias') {
                  await handleAliasCopy(from);
                  continue;
                }
              }

              const textBody = message.text?.body;
              
              if (textBody) {
                await ConversationMessage.create({ 
                  platform: 'whatsapp', 
                  platform_id: from, 
                  body: textBody, 
                  direction: 'inbound', 
                  status: 'delivered' 
                });

                if (isPurchaseIntent(textBody)) {
                  await handlePurchaseIntent(from);
                  continue;
                }
                
                if (isPaymentConfirmation(textBody)) {
                  await handlePaymentConfirmation(from);
                  continue;
                }
                
                const aiResponse = await generateAIResponse(textBody, from);
                const sent = await sendWhatsAppMessage(from, aiResponse);

                if (sent) {
                  await ConversationMessage.create({ 
                    platform: 'whatsapp', 
                    platform_id: from, 
                    body: aiResponse, 
                    direction: 'outbound', 
                    status: 'sent' 
                  });
                }
              }
            }
          }

          if (value.statuses) {
            for (const status of value.statuses) {
              if (status.status === 'failed') {
                logger.error(`[WhatsApp] Error en mensaje ${status.id}`, { errors: status.errors });
              }
            }
          }
        }
      }
      res.status(200).send('EVENT_RECEIVED');
    } else {
      logger.warn('Webhook recibido con objeto no reconocido:', { object: body.object });
      res.sendStatus(404);
    }
  } catch (error: any) {
    logger.error('Error procesando Webhook de Meta:', { message: error.message, stack: error.stack });
    res.sendStatus(500);
  }
};
