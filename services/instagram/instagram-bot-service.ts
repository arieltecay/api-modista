import { sendInstagramMessage } from './instagram-official-service.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { logger } from '../logger.js';

export interface InstagramBotResponse {
  sent: boolean;
  message: string;
}

/**
 * Maneja intención de compra del usuario
 * Envía datos de pago por Instagram DM
 */
export const handlePurchaseIntent = async (
  from: string
): Promise<InstagramBotResponse> => {
  const paymentInfo = `¡Excelente elección! 😊 Aquí te paso los datos para que puedas realizar la transferencia:

Alias: mica.menta
CVU: 0000003100069944243193

Una vez que realices el pago, por favor enviame el comprobante por acá para darte el alta. ¡Muchas gracias!`;

  const sent = await sendInstagramMessage(from, paymentInfo);

  if (sent) {
    await ConversationMessage.create({
      platform: 'instagram',
      platform_id: from,
      body: paymentInfo,
      direction: 'outbound',
      status: 'sent',
    });
  }

  return { sent, message: paymentInfo };
};

/**
 * Maneja confirmación de pago del usuario
 */
export const handlePaymentConfirmation = async (
  from: string
): Promise<InstagramBotResponse> => {
  const confirmationResponse = `¡Gracias por avisarnos! 😊

Estamos verificando tu pago ahora mismo. En breve vas a recibir:
✅ Confirmación por este chat
✅ Link de acceso al curso por mail

¡Gracias por tu paciencia!`;

  const sent = await sendInstagramMessage(from, confirmationResponse);

  if (sent) {
    await ConversationMessage.create({
      platform: 'instagram',
      platform_id: from,
      body: confirmationResponse,
      direction: 'outbound',
      status: 'sent',
    });
  }

  return { sent, message: confirmationResponse };
};

/**
 * Detecta si el texto indica intención de compra
 */
export const isPurchaseIntent = (text: string): boolean => {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes('comprar') ||
    lowerText.includes('pago') ||
    lowerText.includes('transferencia') ||
    lowerText.includes('alias') ||
    lowerText.includes('cvu') ||
    lowerText.includes('precio') ||
    lowerText.includes('cuánto cuesta') ||
    lowerText.includes('costo') ||
    lowerText.includes('valor')
  );
};

/**
 * Detecta si el texto indica confirmación de pago
 */
export const isPaymentConfirmation = (text: string): boolean => {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes('ya pag') ||
    lowerText.includes('ya hice el pago') ||
    lowerText.includes('comprobante') ||
    lowerText.includes('ya realic') ||
    lowerText.includes('pago hecho') ||
    lowerText.includes('ya transfer') ||
    lowerText.includes('pagado')
  );
};
