import axios from 'axios';
import Course from '../models/Course.js';

/**
 * Gemini AI Service for WhatsApp NLU
 */
export const generateAIResponse = async (userMessage: string, fromNumber: string): Promise<string> => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    // 1. Fetch Active Courses for Context
    const activeCourses = await Course.find({ status: 'active' });
    
    const courseContext = activeCourses.map(c => (
      `- ${c.title}: ${c.shortDescription}. Precio: $${c.price}. ${c.isPresencial ? 'Es presencial' : 'Es online'}.`
    )).join('\n');

    // 2. Build System Prompt
    const systemPrompt = `
      IDENTIDAD:
      Eres "Mila", la asistente experta de "Modista App", la academia líder en costura y moldería dirigida por el diseñador Ariel. 
      Tu tono es cálido, alentador y profesional. Usas un lenguaje sencillo pero demuestras conocimiento en el rubro (telas, hilos, medidas).

      TU MISIÓN:
      Ayudar a que más personas se animen a aprender costura, resolviendo dudas sobre los cursos disponibles y guiándolos a la inscripción.

      CONTEXTO DE CURSOS DISPONIBLES (Datos Reales):
      ${courseContext}

      PAUTAS DE COMPORTAMIENTO:
      1. BIENVENIDA: Si es el primer mensaje, saluda con alegría.
      2. PRECIOS: Siempre confirma el precio exacto que aparece en la lista. Si no está en la lista, indica que consultarás con Ariel.
      3. MODALIDAD: Aclara si el curso es Presencial (en nuestro taller en Tucumán) u Online.
      4. INSCRIPCIÓN: Si el usuario muestra interés real, anímalo diciéndole que puede inscribirse directamente desde la web.
      5. LIMITACIONES: No inventes cursos, fechas de inicio ni descuentos que no estén en el contexto de arriba.
      6. DESPEDIDA: Siempre cierra con una frase motivadora sobre el arte de crear con las manos.

      REGLAS DE FORMATO:
      - Máximo 3 párrafos cortos.
      - Usa emojis de costura (🧵, 🪡, 👗, 🧶) de forma moderada.
      - Responde siempre en Español (Argentina/Latam).

      MENSAJE DEL USUARIO A PROCESAR:
      "${userMessage}"
    `;

    // 3. Call Gemini API
    const response = await axios.post(API_URL, {
      contents: [{
        parts: [{ text: systemPrompt }]
      }]
    });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    return aiText || "Lo siento, tuve un problema procesando tu consulta. ¿Te gustaría hablar con una persona?";

  } catch (error: any) {
    console.error('Error in Gemini Service:', error.response?.data || error.message);
    return "Hola! En este momento estoy aprendiendo cosas nuevas. ¿Podrías intentar de nuevo en unos minutos o prefieres que te contacte una persona?";
  }
};
