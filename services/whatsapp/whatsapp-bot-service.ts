import { sendWhatsAppMessage } from '../whatsapp-official-service.js';
import ConversationMessage from '../../models/ConversationMessage.js';

export interface WhatsAppResponse {
  sent: boolean;
  message: string;
}

export const handlePurchaseIntent = async (from: string): Promise<WhatsAppResponse> => {
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

  return { sent, message: paymentInfo };
};

export const handlePaymentConfirmation = async (from: string): Promise<WhatsAppResponse> => {
  const confirmationResponse = `¡Gracias por avisarnos! 😊

Estamos verificando tu pago ahora mismo. En breve vas a recibir:
✅ Confirmación por este chat
✅ Link de acceso al curso por mail

¡Gracias por tu paciencia!`;

  const sent = await sendWhatsAppMessage(from, confirmationResponse);
  
  if (sent) {
    await ConversationMessage.create({ 
      platform: 'whatsapp', 
      platform_id: from, 
      body: confirmationResponse, 
      direction: 'outbound', 
      status: 'sent' 
    });
  }

  return { sent, message: confirmationResponse };
};

export const handleCvuCopy = async (from: string): Promise<WhatsAppResponse> => {
  const sent = await sendWhatsAppMessage(from, '0000003100069944243193');
  return { sent, message: '0000003100069944243193' };
};

export const handleAliasCopy = async (from: string): Promise<WhatsAppResponse> => {
  const sent = await sendWhatsAppMessage(from, 'mica.menta');
  return { sent, message: 'mica.menta' };
};

export const isPurchaseIntent = (text: string): boolean => {
  const lowerText = text.toLowerCase();
  return lowerText.includes('comprar') || 
         lowerText.includes('pago') || 
         lowerText.includes('transferencia') || 
         lowerText.includes('alias') || 
         lowerText.includes('cvu');
};

export const isPaymentConfirmation = (text: string): boolean => {
  const lowerText = text.toLowerCase();
  return lowerText.includes('ya pag') || 
         lowerText.includes('ya hice el pago') || 
         lowerText.includes('comprobante') || 
         lowerText.includes('ya realic') ||
         lowerText.includes('pago hecho') ||
         lowerText.includes('ya transfer');
};
