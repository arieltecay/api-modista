import crypto from 'crypto';
import { Request, Response } from 'express';
import { MetaWhatsAppWebhookPayload } from '../../types/whatsapp-official.js';
import { generateAIResponse } from '../../services/gemini-service.js';
import { sendWhatsAppMessage } from '../../services/whatsapp-official-service.js';

/**
 * WhatsApp Controller for Meta Cloud API Webhooks
 */
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
};

export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    
    // Validate Signature if META_APP_SECRET is present
    if (process.env.META_APP_SECRET && signature) {
      const elements = signature.split('=');
      const signatureHash = elements[1];
      const expectedHash = crypto
        .createHmac('sha256', process.env.META_APP_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signatureHash !== expectedHash) {
        console.error('Invalid signature from Meta Webhook');
        return res.sendStatus(401);
      }
    }

    const body: MetaWhatsAppWebhookPayload = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          const value = change.value;
          
          // Handle Messages
          if (value.messages) {
            for (const message of value.messages) {
              const from = message.from;
              const textBody = message.text?.body;
              
              if (textBody) {
                console.log(`Received message from ${from}: ${textBody}`);
                
                // Get AI Response using Gemini
                const aiResponse = await generateAIResponse(textBody, from);
                
                // Send response back via WhatsApp
                await sendWhatsAppMessage(from, aiResponse);
              }
            }
          }

          // Handle Status Updates (sent, delivered, read)
          if (value.statuses) {
            for (const status of value.statuses) {
              console.log(`Status update for message ${status.id}: ${status.status}`);
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
