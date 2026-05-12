import axios from 'axios';

/**
 * WhatsApp Official Service (Meta Cloud API)
 */
export const sendWhatsAppMessage = async (to: string, message: string): Promise<boolean> => {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
  
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.error('[WhatsApp Error] Credentials missing in environment variables');
    return false;
  }

  // Sanitizar número de Argentina para ruteo internacional (54 + código area + número)
  // Se quita el '9' si está presente (549 -> 54) para coincidir con el ruteo oficial de Meta Business
  let formattedTo = to.startsWith('549') ? '54' + to.substring(3) : to;

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

    console.log(`[WhatsApp OK] Mensaje enviado a ${formattedTo}. ID: ${response.data.messages[0].id}`);
    return true;
  } catch (error: any) {
    console.error('[WhatsApp Error] Detalle API Meta:', error.response?.data || error.message);
    return false;
  }
};

/**
 * Fetches all message templates from the WhatsApp Business Account
 */
export const getWhatsAppTemplates = async () => {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const WABA_ID = process.env.META_WABA_ID;

  if (!ACCESS_TOKEN || !WABA_ID) {
    console.error('[WhatsApp Error] Credentials missing for template management');
    return [];
  }

  const API_URL = `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`;

  try {
    const response = await axios.get(API_URL, {
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
    });
    console.log(`[WhatsApp Debug] Plantillas recuperadas de Meta: ${response.data.data.length}`);
    // Logueamos los nombres para ver si Meta las está filtrando por algún motivo
    console.log('[WhatsApp Debug] Nombres:', response.data.data.map((t: any) => t.name).join(', '));
    return response.data.data;
  } catch (error: any) {
    console.error('[WhatsApp Error] Fallo al obtener plantillas:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Creates a new message template in Meta
 */
export const createWhatsAppTemplate = async (templateData: any) => {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const WABA_ID = process.env.META_WABA_ID;

  if (!ACCESS_TOKEN || !WABA_ID) throw new Error('Meta credentials missing');

  const API_URL = `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`;

  try {
    const response = await axios.post(API_URL, templateData, {
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
    });
    return response.data;
  } catch (error: any) {
    console.error('[WhatsApp Error] Fallo al crear plantilla:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Deletes a message template from Meta
 */
export const deleteWhatsAppTemplate = async (templateName: string) => {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const WABA_ID = process.env.META_WABA_ID;

  if (!ACCESS_TOKEN || !WABA_ID) throw new Error('Meta credentials missing');

  // Según la documentación de Meta, para borrar por nombre se usa el parámetro 'name'
  // y se debe hacer el DELETE sobre el endpoint de message_templates del WABA.
  const API_URL = `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`;

  try {
    const response = await axios.delete(API_URL, {
      params: {
        name: templateName,
        access_token: ACCESS_TOKEN
      }
    });
    return response.data;
  } catch (error: any) {
    console.error('[WhatsApp Error] Fallo al eliminar plantilla:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Sends a pre-approved Meta template
 */
export const sendWhatsAppTemplate = async (to: string, templateName: string, components: any[] = [], languageCode: string = 'es_AR'): Promise<boolean> => {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
  
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) return false;

  const API_URL = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

  // Sanitizar número
  let formattedTo = to.startsWith('549') ? '54' + to.substring(3) : to;

  try {
    await axios.post(
      API_URL,
      {
        messaging_product: 'whatsapp',
        to: formattedTo,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode
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
    console.error(`[WhatsApp Error] Fallo al enviar plantilla ${templateName} (${languageCode}):`, error.response?.data || error.message);
    return false;
  }
};
