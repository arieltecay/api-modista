import crypto from 'crypto';
import { Request, Response } from 'express';
import { 
  InstagramWebhookPayload, 
  InstagramWebhookChangeValue,
  InstagramCommentValue,
} from '../../types/instagram-official.js';
import { generateAIResponse } from '../../services/gemini-service.js';
import { answerEnrollmentMessage } from '../../services/BotEnrollment/index.js';
import { getInstagramReplyPolicy } from '../../services/BotReplyPolicy/index.js';
import { processBotWebhookMessage } from '../../services/BotWebhookEvent/index.js';
import { commentEventKey, parseCommentChange, processInstagramComment } from '../../services/instagram/instagram-comment-service.js';
import { sendInstagramMessage } from '../../services/instagram/instagram-official-service.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { logger } from '../../services/logger.js';

let lastSignatureMismatchLogAt = 0;

const SENDER_FIELDS = new Set(['sender', 'recipient', 'timestamp']);
/** Tipo de un evento sin mensaje (read, reaction, postback...), sin ningún dato del usuario. */
const eventKind = (messaging: object): string => Object.keys(messaging).filter(key => !SENDER_FIELDS.has(key)).join('+') || 'unknown';

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
      const now = Date.now();
      if (now - lastSignatureMismatchLogAt > 5 * 60_000) {
        lastSignatureMismatchLogAt = now;
        logger.warn('[Instagram Webhook] Firma HMAC inválida', {
          contentType: req.get('content-type')?.slice(0, 80),
          userAgent: req.get('user-agent')?.slice(0, 120),
          bodyBytes: req.rawBody.length,
        });
      }
      return res.sendStatus(401);
    }

    const body: InstagramWebhookPayload = req.body;
    const summary = { texts: 0, comments: 0, echoes: 0, nonText: 0, ignored: [] as string[] };

    if (body.object !== 'instagram') {
      logger.warn('[Instagram Webhook] Objeto no reconocido:', { object: body.object });
      return res.sendStatus(404);
    }

    const handleCommentChange = async (field: string, value: InstagramCommentValue | undefined, entryId: string) => {
      const parsed = parseCommentChange(field, value, [process.env.META_INSTAGRAM_USER_ID, entryId]);
      if ('ignored' in parsed) {
        summary.ignored.push(parsed.ignored);
        return;
      }
      await processBotWebhookMessage('instagram', commentEventKey(parsed.event.commentId), () => processInstagramComment(parsed.event));
      summary.comments += 1;
    };

    for (const entry of body.entry) {
      // Instagram Login entrega los comentarios directamente en la entrada (sin changes[]).
      if (entry.field) await handleCommentChange(entry.field, entry.value, entry.id);

      // Formato legacy: entry.messaging[]
      if (entry.messaging) {
        for (const messaging of entry.messaging) {
          if (!messaging.message) {
            summary.ignored.push(eventKind(messaging));
            continue;
          }

          // BUG #3: Ignorar echos para prevenir loops de mensajeria
          if (messaging.message.is_echo) {
            logger.info('[Instagram Webhook] Se detectó evento de tipo ECO (legacy), ignorando');
            summary.echoes += 1;
            continue;
          }

          const from = messaging.sender.id;
          const textBody = messaging.message.text;

          if (!textBody) {
            logger.info('[Instagram Webhook] Mensaje sin texto (imagen/sticker), ignorado');
            summary.nonText += 1;
            continue;
          }

          if (messaging.message.mid) {
            await processBotWebhookMessage('instagram', messaging.message.mid, () => processInstagramMessage(from, textBody, messaging.message.mid));
            summary.texts += 1;
          } else {
            summary.ignored.push('message_without_id');
          }
        }
      }

      // Formato Cloud API v2: entry.changes[].value.messages[]
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field !== 'messages') {
            await handleCommentChange(change.field, change.value as InstagramCommentValue, entry.id);
            continue;
          }

          const value = change.value as InstagramWebhookChangeValue;
          
          if (value.messages) {
            for (const message of value.messages) {
              const from = message.from;

              // BUG #3: Ignorar echos del propio bot en Cloud API para evitar loops
              if (from === process.env.META_INSTAGRAM_USER_ID) {
                logger.info('[Instagram Webhook] Se detectó evento de origen bot (Cloud API), ignorando echo');
                summary.echoes += 1;
                continue;
              }

              // @ts-ignore
              if (message.is_echo) {
                logger.info('[Instagram Webhook] Se detectó bandera is_echo en Cloud API, ignorando echo');
                summary.echoes += 1;
                continue;
              }
              
              let textBody = message.text?.body;

              // Si no hay texto (es imagen, video, etc.), solo persistimos
              if (!textBody && message.type !== 'text') {
                await processBotWebhookMessage('instagram', message.id, async () => {
                  await ConversationMessage.updateOne(
                    { platform: 'instagram', externalMessageId: message.id },
                    { $setOnInsert: { platform_id: from, body: `[${message.type.toUpperCase()}]`, direction: 'inbound', status: 'delivered' } },
                    { upsert: true },
                  );
                });
                summary.nonText += 1;
                continue;
              }

              if (!textBody) continue;

              await processBotWebhookMessage('instagram', message.id, () => processInstagramMessage(from, textBody, message.id));
              summary.texts += 1;
            }
          }
        }
      }
    }

    logger.info('[Instagram Webhook] Resumen', summary);
    res.status(200).send('EVENT_RECEIVED');
  } catch (error: any) {
    logger.error('[Instagram Webhook] Error procesando mensaje:', { message: error.message, stack: error.stack });
    res.sendStatus(500);
  }
};

/**
 * Procesa un mensaje de texto de Instagram
 */
async function processInstagramMessage(from: string, text: string, messageId: string) {
  // 1. Persistir mensaje entrante
  await ConversationMessage.updateOne(
    { platform: 'instagram', externalMessageId: messageId },
    { $setOnInsert: { platform_id: from, body: text, direction: 'inbound', status: 'delivered' } },
    { upsert: true },
  );

  const matchedInstructions = await getInstagramReplyPolicy(text);
  if (matchedInstructions.length === 0) return;

  const canCheckEnrollment = matchedInstructions.some(instruction => instruction.instagramEnrollmentLookup);
  if (canCheckEnrollment) {
    const enrollmentAnswer = await answerEnrollmentMessage('instagram', from, text);
    if (enrollmentAnswer) {
      const sent = await sendInstagramMessage(from, enrollmentAnswer);
      if (!sent) throw new Error('No se pudo entregar la respuesta de inscripción por Instagram');
      await ConversationMessage.create({ platform: 'instagram', platform_id: from, body: enrollmentAnswer, direction: 'outbound', status: 'sent' });
      return;
    }
  }

  // Solo usa la información de las reglas de Instagram que coincidieron.
  try {
    const aiResponse = await generateAIResponse(text, from, 'instagram', matchedInstructions);
    const sent = await sendInstagramMessage(from, aiResponse);

    if (!sent) throw new Error('No se pudo entregar la respuesta de Gemini por Instagram');
    await ConversationMessage.create({ platform: 'instagram', platform_id: from, body: aiResponse, direction: 'outbound', status: 'sent' });
  } catch (aiError: any) {
    logger.error('[Instagram] Error al generar respuesta IA:', aiError.message);
    throw aiError;
  }
}
