import crypto from 'crypto';
import { Request, Response } from 'express';
import { MetaWhatsAppWebhookPayload } from '../../types/whatsapp-official.js';
import { generateAIResponse } from '../../services/gemini-service.js';
import { answerEnrollmentMessage } from '../../services/BotEnrollment/index.js';
import { getWhatsAppFixedReply } from '../../services/BotReplyPolicy/index.js';
import { processBotWebhookMessage } from '../../services/BotWebhookEvent/index.js';
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
    const signature = req.headers['x-hub-signature-256'];
    if (!process.env.META_APP_SECRET) return res.sendStatus(503);
    if (typeof signature !== 'string' || !req.rawBody || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return res.sendStatus(401);
    const signatureHash = signature.slice('sha256='.length);
    const expectedHash = crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(req.rawBody)
      .digest();

    if (!crypto.timingSafeEqual(Buffer.from(signatureHash, 'hex'), expectedHash)) {
      logger.warn('⚠️ Validación de firma HMAC fallida en Webhook de WhatsApp');
      return res.sendStatus(401);
    }

    const body: MetaWhatsAppWebhookPayload = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          const value = change.value;
          
          if (value.messages) {
            for (const message of value.messages) {
              await processBotWebhookMessage('whatsapp', message.id, async () => {
                const from = message.from;
              
                if (message.type === 'button' && message.button) {
                  const buttonText = message.button.text;
                
                  if (buttonText === 'Copiar CVU') {
                    await handleCvuCopy(from);
                    return;
                  }
                
                  if (buttonText === 'Copiar Alias') {
                    await handleAliasCopy(from);
                    return;
                  }
                }

                const textBody = message.text?.body;
              
                if (textBody) {
                  await ConversationMessage.updateOne(
                    { platform: 'whatsapp', externalMessageId: message.id },
                    { $setOnInsert: { platform_id: from, body: textBody, direction: 'inbound', status: 'delivered' } },
                    { upsert: true },
                  );

                  const enrollmentAnswer = await answerEnrollmentMessage('whatsapp', from, textBody);
                  if (enrollmentAnswer) {
                    const sent = await sendWhatsAppMessage(from, enrollmentAnswer);
                    if (!sent) throw new Error('No se pudo entregar la respuesta de inscripción por WhatsApp');
                    await ConversationMessage.create({ platform: 'whatsapp', platform_id: from, body: enrollmentAnswer, direction: 'outbound', status: 'sent' });
                    return;
                  }

                  const fixedReply = await getWhatsAppFixedReply(textBody);
                  if (fixedReply) {
                    const sent = await sendWhatsAppMessage(from, fixedReply, from);
                    if (!sent) throw new Error('No se pudo entregar la respuesta fija por WhatsApp');
                    return;
                  }

                  if (isPaymentConfirmation(textBody)) {
                    await handlePaymentConfirmation(from);
                    return;
                  }

                  if (isPurchaseIntent(textBody)) {
                    await handlePurchaseIntent(from);
                    return;
                  }
                
                  const aiResponse = await generateAIResponse(textBody, from, 'whatsapp');
                  const sent = await sendWhatsAppMessage(from, aiResponse);

                  if (!sent) throw new Error('No se pudo entregar la respuesta de Gemini por WhatsApp');
                  await ConversationMessage.create({ platform: 'whatsapp', platform_id: from, body: aiResponse, direction: 'outbound', status: 'sent' });
                }
              });
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
