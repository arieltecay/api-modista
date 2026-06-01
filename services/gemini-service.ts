import axios from 'axios';
import Course from '../models/Course.js';
import FAQ from '../models/FAQ.js';
import BotInstruction from '../models/BotInstruction.js';
import { sanitizePromptChunk } from '../utils/stringUtils.js';

/**
 * Gemini AI Service for WhatsApp & Instagram NLU
 */
export const generateAIResponse = async (
  userMessage: string, 
  fromNumber: string,
  platform?: 'whatsapp' | 'instagram'
): Promise<string> => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    // 1. Fetch Dynamic Bot Instructions (Modular Prompt)
    const activeInstructions = await BotInstruction.find({ isActive: true }).sort({ order: 1 });
    
    let botContext = '';
    
    if (activeInstructions.length > 0) {
      botContext = activeInstructions.map(inst => {
        return `### ${inst.title.toUpperCase()}\n${sanitizePromptChunk(inst.content)}`;
      }).join('\n\n');
    } else {
      // Fallback a identidad básica si no hay instrucciones configuradas
      botContext = `
        IDENTIDAD:
        Eres "Mila", la asistente experta de "Modista App", la academia líder en costura y moldería dirigida por la diseñadora Micaela Guevara. 
        Tu tono es cálido, alentador y profesional.

        TU MISIÓN:
        Ayudar a que las personas se inscriban en los cursos.
      `;
    }

    // 2. Fetch Active Courses for Context
    const activeCourses = await Course.find({ status: 'active' });
    const courseContext = activeCourses.map(c => {
      const cleanTitle = c.title.replace(/\s+/g, ' ').trim();
      return `- ${cleanTitle}: ${c.shortDescription}. Precio: $${c.price}. ${c.isPresencial ? 'Es presencial' : 'Es online'}.`;
    }).join('\n');

    // 3. Fetch Active FAQs for Context
    const activeFaqs = await FAQ.find({ status: 'active' });
    const faqContext = activeFaqs.map(f => (
      `P: ${f.question}\nR: ${f.answer}`
    )).join('\n\n');

    // 4. Build Final System Prompt
    const platformContext = platform 
      ? `\nPLATAFORMA: Estás respondiendo por ${platform === 'instagram' ? 'Instagram DM' : 'WhatsApp'}.`
      : '';

    const systemPrompt = `
      ${botContext}

      CONTEXTO DE CURSOS DISPONIBLES (Datos Reales):
      ${courseContext}

      PREGUNTAS FRECUENTES Y POLÍTICAS:
      ${faqContext}
      ${platformContext}

      REGLAS DE ORO ADICIONALES:
      1. BÚSQUEDA FLEXIBLE: Si el usuario pregunta por un tema (ej: "pantalón", "chaleco", "abrigo"), busca en tu contexto de cursos. Si hay algo parecido, ¡OFRÉCELO!
      2. PRECIOS: Cita siempre el precio exacto de la lista.
      3. INSCRIPCIÓN: Anímalos a inscribirse en https://modista-app.com.
      
      MENSAJE DEL USUARIO A PROCESAR:
      "${userMessage}"
    `;

    // 5. Call Gemini API
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
