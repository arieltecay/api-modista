import fs from 'fs/promises';
import path from 'path';

const templatesDir = path.join(process.cwd(), 'templates');

/**
 * Escapa texto que escribió una persona antes de pasarlo a una plantilla. Neutraliza también `$`:
 * `renderTemplate` usa `String.replace` y un `$&` en el valor se interpretaría como patrón.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\$/g, '&#36;');

/**
 * Lee un archivo de plantilla HTML y reemplaza los marcadores de posición.
 * Los marcadores de posición deben tener el formato {{key}}.
 * @param {string} templateName - El nombre del archivo de la plantilla (sin .html).
 * @param {Record<string, string>} data - Un objeto donde cada clave corresponde a un marcador en la plantilla.
 * @returns {Promise<string>} El contenido HTML con los datos inyectados.
 */
export const renderTemplate = async (templateName: string, data: Record<string, string>): Promise<string> => {
  const filePath = path.join(templatesDir, `${templateName}.html`);

  try {
    let content = await fs.readFile(filePath, 'utf-8');

    // Reemplaza cada {{key}} con su valor correspondiente del objeto data
    for (const key in data) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      content = content.replace(regex, data[key]);
    }

    return content;
  } catch (error) {
    console.error(`Error al renderizar la plantilla: ${templateName}`, error);
    throw new Error('No se pudo cargar la plantilla de correo.');
  }
};