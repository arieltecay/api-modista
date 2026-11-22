import { escapeHtml } from '../fsTemplate.js';

/** HTML for the `{{invoiceBlock}}` slot of the access email: a link to the public invoice page. */
export const invoiceEmailBlock = (invoiceUrl: string): string =>
  `<p>Tu factura oficial (ARCA) ya está disponible: ` +
  `<a href="${escapeHtml(invoiceUrl)}" target="_blank">ver, imprimir o guardar mi factura</a>.</p>`;
