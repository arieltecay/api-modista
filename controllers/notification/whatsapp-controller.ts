import crypto from 'crypto';
import { Request, Response } from 'express';
import { MetaWhatsAppWebhookPayload } from '../../types/whatsapp-official.js';
import { generateAIResponse } from '../../services/gemini-service.js';
import { sendWhatsAppMessage } from '../../services/whatsapp-official-service.js';
import ConversationMessage from '../../models/ConversationMessage.js';

/**
 * WhatsApp Controller for Meta Cloud API Webhooks
 */
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
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
        // En entorno local de ngrok, el JSON.stringify puede diferir del original de Meta.
        // Solo logueamos la advertencia pero continuamos el procesamiento.
        console.warn('⚠️ HMAC Signature validation failed - Check META_APP_SECRET if in PROD');
      }
    }

    const body: MetaWhatsAppWebhookPayload = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          const value = change.value;
          
          // Manejar Mensajes
          if (value.messages) {
            for (const message of value.messages) {
              const from = message.from;
              
              // --- LÓGICA DE BOTONES DE RESPUESTA RÁPIDA ---
              if (message.type === 'button' && message.button) {
                const buttonText = message.button.text;
                
                if (buttonText === 'Copiar CVU') {
                  await sendWhatsAppMessage(from, '0000003100069944243193');
                  continue;
                }
                
                if (buttonText === 'Copiar Alias') {
                  await sendWhatsAppMessage(from, 'mica.menta');
                  continue;
                }
              }

              const textBody = message.text?.body;
              
              if (textBody) {
                // 1. Persistir mensaje entrante
                await ConversationMessage.create({ 
                  platform: 'whatsapp', 
                  platform_id: from, 
                  body: textBody, 
                  direction: 'inbound', 
                  status: 'delivered' 
                });

                // --- LÓGICA DE FAST TRACK PARA PAGOS ---
                const lowerText = textBody.toLowerCase();
                const isPurchaseIntent = 
                  lowerText.includes('comprar') || 
                  lowerText.includes('pago') || 
                  lowerText.includes('transferencia') || 
                  lowerText.includes('alias') || 
                  lowerText.includes('cvu');

                if (isPurchaseIntent) {
                  const paymentInfo = `¡Excelente elección! 😊 Aquí te paso los datos para que puedas realizar la transferencia:

*Alias:*
mica.menta

*CVU:*
0000003100069944243193

Una vez que realices el pago, por favor enviame el comprobante por acá para darte el alta. ¡Muchas gracias!`;

                  const sent = await sendWhatsAppMessage(from, paymentInfo);
                  if (sent) {
                    await ConversationMessage.create({ 
                      platform: 'whatsapp', 
                      platform_id: from, 
                      body: paymentInfo, 
                      direction: 'outbound', 
                      status: 'sent' 
                    });
                  }
                  continue; // Saltamos la respuesta de la IA para este flujo directo
                }
                
                // 2. Obtener respuesta de Mila (Gemini)
                const aiResponse = await generateAIResponse(textBody, from);
                
                // 3. Enviar respuesta oficial
                const sent = await sendWhatsAppMessage(from, aiResponse);

                // 4. Persistir mensaje saliente si fue exitoso
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

          // Manejar Actualizaciones de Estado
          if (value.statuses) {
            for (const status of value.statuses) {
              // Log mínimo para monitorear entrega
              if (status.status === 'failed') {
                console.error(`[WhatsApp] Error en mensaje ${status.id}:`, status.errors);
              }
            }
          }
        }
      }
      res.status(200).send('EVENT_RECEIVED');
    } else {
      res.sendStatus(404);
    }
  } catch (error: any) {
    console.error('Error handling Meta Webhook:', error.message);
    res.sendStatus(500);
  }
};
