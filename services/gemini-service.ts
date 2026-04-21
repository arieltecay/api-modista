import axios from 'axios';
import Course from '../models/Course.js';

/**
 * Gemini AI Service for WhatsApp NLU
 */
export const generateAIResponse = async (userMessage: string, fromNumber: string): Promise<string> => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;

  try {
    // 1. Fetch Active Courses for Context
    const activeCourses = await Course.find({ status: 'active' });
    
    const courseContext = activeCourses.map(c => (
      `- ${c.title}: ${c.shortDescription}. Precio: $${c.price}. ${c.isPresencial ? 'Es presencial' : 'Es online'}.`
    )).join('\n');

    // 2. Build System Prompt
    const systemPrompt = `
      Eres el asistente virtual oficial de "Modista App", la academia de costura y moldería de Ariel.
      Tu objetivo es ayudar a los usuarios con dudas sobre los cursos.
      
      INFORMACIÓN DE LOS CURSOS ACTUALES:
      ${courseContext}
      
      REGLAS DE RESPUESTA:
      1. Sé amable, profesional y usa un tono cercano.
      2. Responde en español de forma concisa (máximo 3-4 oraciones).
      3. Si el usuario pregunta por un curso que no está en la lista, indícale que por ahora no está disponible.
      4. Si el usuario pregunta por algo que no sabes, dile amablemente que vas a derivar su consulta a una persona real.
      5. No inventes precios ni fechas que no estén en el contexto.
      6. Si preguntan por la ubicación, menciona que estamos en Tucumán (si corresponde al negocio).
      
      MENSAJE DEL USUARIO:
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
