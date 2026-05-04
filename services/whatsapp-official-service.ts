import axios from 'axios';

/**
 * WhatsApp Official Service (Meta Cloud API)
 */
export const sendWhatsAppMessage = async (to: string, message: string): Promise<boolean> => {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
  
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.error('WhatsApp API credentials missing in environment variables');
    return false;
  }

  // Sanitizar número de Argentina para ruteo internacional (54 + código area + número)
  // Probamos el formato sin el 9, pero asegurándonos de que Meta lo reconozca como número válido.
  let formattedTo = to.startsWith('549') ? '54' + to.substring(3) : to;

  console.log(`[DEBUG Meta] Enviando mensaje final a: ${formattedTo}`);

  const API_URL = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

  try {
    const response = await axios.post(
      API_URL,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedTo,
        type: 'text',
        text: {
          preview_url: false,
          body: message
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`WhatsApp message sent to ${formattedTo}. ID: ${response.data.messages[0].id}`);
    return true;
  } catch (error: any) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    return false;
  }
};

/**
 * Sends a pre-approved Meta template
 */
export const sendWhatsAppTemplate = async (to: string, templateName: string, components: any[] = []): Promise<boolean> => {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
  
  const API_URL = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(
      API_URL,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: 'es_AR' // o 'es' según corresponda
          },
          components: components
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      }
    );
    return true;
  } catch (error: any) {
    console.error(`Error sending template ${templateName}:`, error.response?.data || error.message);
    return false;
  }
};
