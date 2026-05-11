/**
 * Utilidades para manipulación de strings y sanitización de prompts.
 */

/**
 * Sanitiza un fragmento de texto para ser usado en un prompt de IA,
 * eliminando caracteres de control que rompen JSON pero preservando
 * el formato visual, saltos de línea y emojis.
 */
export const sanitizePromptChunk = (text: string): string => {
  if (!text) return '';

  return text
    // 1. Normalizar saltos de línea a \n
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 2. Eliminar caracteres de control invisibles (excepto \n)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, '')
    // 3. Limpiar espacios al inicio y final de cada línea para consistencia
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // 4. Limpiar espacios en blanco al inicio y final del bloque
    .trim();
};

/**
 * Limpia ruidos excesivos de texto (múltiples espacios, etc)
 */
export const cleanText = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim();
};
