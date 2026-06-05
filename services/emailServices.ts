import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs/promises';
import path from 'path';
import { renderTemplate } from './fsTemplate.js';
import { logger } from './logger.js';

const sentEmailsDir = path.join(process.cwd(), 'sent_emails');

/**
 * Para un envío real, Nodemailer se conecta a un servidor SMTP.
 * Las credenciales se toman del archivo .env.
 */
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', // Cambia esto por tu proveedor de SMTP
  port: 465,
  secure: true, // true para 465, false para otros puertos
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  templateName: string;
  data: Record<string, string>;
}

/**
 * Envía un correo electrónico basado en una plantilla.
 * Dependiendo de la variable de entorno EMAIL_MODE, lo enviará realmente
 * o lo guardará como un archivo .html en la carpeta /sent_emails.
 * @param {object} options
 * @param {string} options.to - El destinatario del correo.
 * @param {string} options.subject - El asunto del correo.
 * @param {string} options.templateName - El nombre del archivo de la plantilla (sin .html).
 * @param {object} options.data - Un objeto con los datos para rellenar la plantilla.
 */
export const sendEmail = async ({ to, subject, templateName, data }: EmailOptions): Promise<void> => {
  // 1. Renderizar el contenido HTML usando el servicio de plantillas
  const htmlContent = await renderTemplate(templateName, data);

  const isProduction = process.env.NODE_ENV === 'production';
  const emailMode = process.env.EMAIL_MODE || (isProduction ? 'smtp' : 'file');

  if (emailMode === 'file') {
    // MODO LOCAL: Guardar el correo como un archivo HTML para depuración
    await fs.mkdir(sentEmailsDir, { recursive: true });
    const filePath = path.join(sentEmailsDir, `${Date.now()}-${to}.html`);
    await fs.writeFile(filePath, htmlContent);
    logger.info(`📧 Correo simulado para ${to} guardado en: ${filePath}`);
  } else {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('Faltan las credenciales de EMAIL_USER o EMAIL_PASS en las variables de entorno.\n' +
        'Si usas Gmail, asegúrate de usar una App Password y que el archivo .env esté presente y cargado.');
    }
    // MODO PRODUCCIÓN: Enviar el correo usando Nodemailer
    const mailOptions = {
      from: `"Modista App" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: htmlContent,
    };
    try {
      await transporter.sendMail(mailOptions);
      // console.log(`📧 Correo de confirmación enviado a ${to} via SMTP.`);
    } catch (error) {
      logger.error('Error al enviar el correo:', error);
      throw new Error('Error al enviar correo: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
};

/**
 * Agrega parámetros UTM a una URL de pago para atribución correcta.
 * Cuando el usuario regresa desde el email para pagar, el dashboard
 * y Meta lo reconocen como tráfico de email y no como direct.
 */
const appendPaymentUTMs = (paymentLink: string, courseTitle: string): string => {
  if (!paymentLink) return paymentLink;
  try {
    const url = new URL(paymentLink);
    url.searchParams.set('utm_source', 'email');
    url.searchParams.set('utm_medium', 'email');
    url.searchParams.set('utm_campaign', 'payment_reminder');
    url.searchParams.set('utm_content', encodeURIComponent(courseTitle || 'curso'));
    return url.toString();
  } catch {
    // Si la URL no es válida, retornar el original sin modificar
    return paymentLink;
  }
};

/**
 * Envía un correo de confirmación de seña.
 */
export const sendDepositEmail = async (inscription: any): Promise<void> => {
  const horario = inscription.turnoId && typeof inscription.turnoId === 'object'
    ? `${inscription.turnoId.diaSemana} - ${inscription.turnoId.horaInicio} hs`
    : 'A coordinar';

  // Usar el monto del último pago si está disponible, si no, usar el total (para compatibilidad)
  const monto = inscription.lastPaymentAmount || inscription.depositAmount;
  const paymentLink = appendPaymentUTMs(inscription.paymentLink, inscription.courseTitle);

  const data = {
    nombre: inscription.nombre,
    apellido: inscription.apellido,
    courseTitle: inscription.courseTitle,
    horario: horario,
    monto: monto.toString(),
    fecha: new Date().toLocaleDateString('es-AR')
  };

  await sendEmail({
    to: inscription.email,
    subject: `Confirmación de pago: ${inscription.courseTitle}`,
    templateName: 'depositConfirmation',
    data
  });
};
