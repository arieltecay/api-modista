import crypto from 'crypto';
import { Request, Response } from 'express';
import { 
  InstagramWebhookPayload, 
  InstagramWebhookChangeValue 
} from '../../types/instagram-official.js';
import { generateAIResponse } from '../../services/gemini-service.js';
import { sendInstagramMessage } from '../../services/instagram/instagram-official-service.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { logger } from '../../services/logger.js';
import { 
  handlePurchaseIntent, 
  handlePaymentConfirmation,
  isPurchaseIntent,
  isPaymentConfirmation 
} from '../../services/instagram/instagram-bot-service.js';

/**
 * @route   GET /api/notification/instagram/webhook
 * @desc    Verificación del webhook de Instagram
 */
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;
  const verifyToken = process.env.META_INSTAGRAM_VERIFY_TOKEN;

  if (!verifyToken) {
    logger.error('[Instagram Webhook] META_INSTAGRAM_VERIFY_TOKEN no configurado');
    return res.sendStatus(503);
  }

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('[Instagram Webhook] Verificado con éxito');
      res.status(200).send(challenge);
    } else {
      logger.warn('[Instagram Webhook] Falló verificación: token inválido');
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
};

/**
 * @route   POST /api/notification/instagram/webhook
 * @desc    Procesa mensajes entrantes de Instagram DM
 */
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const appSecret = process.env.META_INSTAGRAM_APP_SECRET;
    const signature = req.headers['x-hub-signature-256'];

    if (!appSecret) {
      logger.error('[Instagram Webhook] META_INSTAGRAM_APP_SECRET no configurado');
      return res.sendStatus(503);
    }

    if (!req.rawBody || typeof signature !== 'string') {
      logger.warn('[Instagram Webhook] Firma o cuerpo original ausente');
      return res.sendStatus(401);
    }

    const [algorithm, signatureHash] = signature.split('=');
    if (algorithm !== 'sha256' || !signatureHash || !/^[a-f0-9]{64}$/i.test(signatureHash)) {
      logger.warn('[Instagram Webhook] Formato de firma inválido');
      return res.sendStatus(401);
    }

    const receivedHash = Buffer.from(signatureHash, 'hex');
    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest();

    if (receivedHash.length !== expectedHash.length || !crypto.timingSafeEqual(receivedHash, expectedHash)) {
      logger.warn('⚠️ Validación de firma HMAC fallida en Webhook de Instagram');
      return res.sendStatus(401);
    }

    const body: InstagramWebhookPayload = req.body;

    if (body.object !== 'instagram') {
      logger.warn('[Instagram Webhook] Objeto no reconocido:', { object: body.object });
      return res.sendStatus(404);
    }

    for (const entry of body.entry) {
      // Formato legacy: entry.messaging[]
      if (entry.messaging) {
        for (const messaging of entry.messaging) {
          if (!messaging.message) continue;

          // BUG #3: Ignorar echos para prevenir loops de mensajeria
          if (messaging.message.is_echo) {
            logger.info('[Instagram Webhook] Se detectó evento de tipo ECO (legacy), ignorando');
            continue;
          }

          const from = messaging.sender.id;
          const textBody = messaging.message.text;

          if (!textBody) {
            logger.info('[Instagram Webhook] Mensaje sin texto (imagen/sticker), ignorado');
            continue;
          }

          await processInstagramMessage(from, textBody);
        }
      }

      // Formato Cloud API v2: entry.changes[].value.messages[]
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field !== 'messages') continue;

          const value = change.value as InstagramWebhookChangeValue;
          
          if (value.messages) {
            for (const message of value.messages) {
              const from = message.from;

              // BUG #3: Ignorar echos del propio bot en Cloud API para evitar loops
              if (from === process.env.META_INSTAGRAM_USER_ID) {
                logger.info('[Instagram Webhook] Se detectó evento de origen bot (Cloud API), ignorando echo');
                continue;
              }

              // @ts-ignore
              if (message.is_echo) {
                logger.info('[Instagram Webhook] Se detectó bandera is_echo en Cloud API, ignorando echo');
                continue;
              }
              
              let textBody = message.text?.body;

              // Si no hay texto (es imagen, video, etc.), solo persistimos
              if (!textBody && message.type !== 'text') {
                await ConversationMessage.create({ 
                  platform: 'instagram', 
                  platform_id: from, 
                  body: `[${message.type.toUpperCase()}]`, 
                  direction: 'inbound', 
                  status: 'delivered' 
                });
                continue;
              }

              if (!textBody) continue;

              await processInstagramMessage(from, textBody);
            }
          }
        }
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (error: any) {
    logger.error('[Instagram Webhook] Error procesando mensaje:', { message: error.message, stack: error.stack });
    res.sendStatus(500);
  }
};

/**
 * Procesa un mensaje de texto de Instagram
 */
async function processInstagramMessage(from: string, text: string) {
  // 1. Persistir mensaje entrante
  await ConversationMessage.create({ 
    platform: 'instagram', 
    platform_id: from, 
    body: text, 
    direction: 'inbound', 
    status: 'delivered' 
  });

  // 2. Detectar intención de compra
  if (isPurchaseIntent(text)) {
    await handlePurchaseIntent(from);
    return;
  }

  // 3. Detectar confirmación de pago
  if (isPaymentConfirmation(text)) {
    await handlePaymentConfirmation(from);
    return;
  }

  // 4. Fallback a IA
  try {
    // @ts-ignore - agregaremos platform pronto en gemini-service
    const aiResponse = await generateAIResponse(text, from, 'instagram');
    const sent = await sendInstagramMessage(from, aiResponse);

    if (sent) {
      await ConversationMessage.create({ 
        platform: 'instagram', 
        platform_id: from, 
        body: aiResponse, 
        direction: 'outbound', 
        status: 'sent' 
      });
    }
  } catch (aiError: any) {
    logger.error('[Instagram] Error al generar respuesta IA:', aiError.message);
  }
}
