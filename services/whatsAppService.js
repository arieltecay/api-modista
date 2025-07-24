import axios from 'axios';
import { renderTemplate } from './fsTemplate.js';

const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * Envía un mensaje de WhatsApp usando una plantilla de mensaje.
 * Para usar esto, necesitas:
 * 1. Una cuenta de WhatsApp Business y acceso a la API de WhatsApp Business.
 * 2. Un número de teléfono verificado.
 * 3. Una plantilla de mensaje creada y APROBADA en tu cuenta de Meta Business Manager.
 *    La plantilla debe tener placeholders para los datos dinámicos, como {{1}}, {{2}}, etc.
 *    Por ejemplo: "Hola {{1}}, gracias por comprar el curso {{2}}. ¡Te contactaremos pronto!"
 * 4. Configurar las variables de entorno WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID con tus credenciales.
 *
 * Esta función utiliza la API de la Nube de WhatsApp.
 */
export const sendWhatsAppMessage = async ({ to, templateName, data }) => {
    try {
        // 1. Renderizar el contenido de los parámetros de la plantilla usando el servicio de plantillas.
        //    Asumimos que la plantilla de WhatsApp se maneja como un string con placeholders en templateService.
        const messageText = await renderTemplate(templateName, data);

        // 2. Construir el cuerpo de la petición para la API de WhatsApp.
        const requestBody = {
            messaging_product: "whatsapp",
            to: to,
            type: "template",
            template: {
                name: templateName, //  El NOMBRE de la plantilla APROBADA en tu cuenta de Meta.
                language: { code: "es_AR" }, //  Código de idioma de la plantilla.
                components: [{ type: "body", parameters: messageText.split(',').map(text => ({ type: "text", text: text.trim() })) }]
            },
        };

        // 3. Enviar la petición a la API de WhatsApp.
        await axios.post(WHATSAPP_API_URL, requestBody, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } });
        console.log(`✅ Mensaje de WhatsApp enviado a ${to} usando la plantilla "${templateName}".`);
    } catch (error) {
        console.error(`❌ Error al enviar mensaje de WhatsApp a ${to} con plantilla "${templateName}":`, error.response?.data || error.message);
        throw new Error(`No se pudo enviar el mensaje de WhatsApp: ${error.response?.data?.error?.message || error.message}`);
    }
};
