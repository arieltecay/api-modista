import axios from 'axios';
import Course from '../models/Course.js';
import FAQ from '../models/FAQ.js';

/**
 * Gemini AI Service for WhatsApp NLU
 */
export const generateAIResponse = async (userMessage: string, fromNumber: string): Promise<string> => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    // 1. Fetch Active Courses for Context
    const activeCourses = await Course.find({ status: 'active' });
    
    const courseContext = activeCourses.map(c => {
      // Sanitizamos el título para quitar saltos de línea y ruidos
      const cleanTitle = c.title.replace(/\s+/g, ' ').trim();
      return `- ${cleanTitle}: ${c.shortDescription}. Precio: $${c.price}. ${c.isPresencial ? 'Es presencial' : 'Es online'}.`;
    }).join('\n');

    // 2. Fetch Active FAQs for Context
    const activeFaqs = await FAQ.find({ status: 'active' });
    const faqContext = activeFaqs.map(f => (
      `P: ${f.question}\nR: ${f.answer}`
    )).join('\n\n');

    // 3. Build System Prompt
    const systemPrompt = `
      IDENTIDAD:
      Eres "Mila", la asistente experta de "Modista App", la academia líder en costura y moldería dirigida por la diseñadora Micaela Guevara. 
      Tu tono es cálido, alentador y profesional.

      TU MISIÓN:
      Ayudar a que las personas se inscriban en los cursos. 

      CONTEXTO DE CURSOS DISPONIBLES (Datos Reales):
      ${courseContext}

      PREGUNTAS FRECUENTES Y POLÍTICAS:
      ${faqContext}

      REGLAS DE ORO PARA RESPONDER:
      1. BÚSQUEDA FLEXIBLE: Si el usuario pregunta por un tema (ej: "pantalón", "chaleco", "abrigo"), busca en tu contexto de cursos de arriba. Si hay algo que coincida o sea muy parecido, ¡OFRÉCELO! No digas que no existe si el tema coincide.
      2. PRECIOS: Cita siempre el precio exacto de la lista.
      3. INSCRIPCIÓN: Anímalos a inscribirse en https://modista-app.com indicando que el proceso es rápido y seguro.
      4. SI NO EXISTE: Solo si realmente no hay nada parecido en la lista, di que vas a consultar con Mica.
      
      MENSAJE DEL USUARIO A PROCESAR:
      "${userMessage}"
    `;

    // 4. Call Gemini API
    const response = await axios.post(API_URL, {
      contents: [{
        parts: [{ text: systemPrompt }]
      }]
    });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    return aiText || "Lo siento, tuve un problema procesando tu consulta. ¿Te gustaría hablar con una persona?";

  } catch (error: any) {
    console.error('[AI Error] Gemini Service:', error.response?.data || error.message);
    return "¡Hola! En este momento estoy aprendiendo cosas nuevas. ¿Podrías intentar de nuevo en unos minutos o prefieres que te contacte una persona?";
  }
};
