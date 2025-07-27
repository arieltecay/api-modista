import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs/promises';
import path from 'path';
import { renderTemplate } from './fsTemplate.js';

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
export const sendEmail = async ({ to, subject, templateName, data }) => {
  // 1. Renderizar el contenido HTML usando el servicio de plantillas
  const htmlContent = await renderTemplate(templateName, data);

  const emailMode = process.env.EMAIL_MODE || 'file';

  if (emailMode === 'file') {
    // MODO LOCAL: Guardar el correo como un archivo HTML para depuración
    await fs.mkdir(sentEmailsDir, { recursive: true });
    const filePath = path.join(sentEmailsDir, `${Date.now()}-${to}.html`);
    await fs.writeFile(filePath, htmlContent);
    console.log(`📧 Correo simulado para ${to} guardado en: ${filePath}`);
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
      console.log(`📧 Correo de confirmación enviado a ${to} via SMTP.`);
    } catch (error) {
      console.error('Error al enviar el correo:', error);
      throw new Error('Error interno del servidor al enviar correo de prueba.');
    }
  }
};
  