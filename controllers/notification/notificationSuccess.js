import { sendEmail } from '../../services/emailServices.js';
import { sendWhatsAppMessage } from '../../services/whatsAppService.js';

export const sendPurchaseNotification = async (req, res) => {
  const { name, email, phone, courseTitle } = req.body;

  if (!name || !email || !phone || !courseTitle) {
    return res.status(400).json({ message: 'Todos los campos son requeridos.' });
  }

  try {
    // 1. Enviar Email de confirmación
    await sendEmail({
      to: email,
      subject: `¡Confirmación de tu compra: ${courseTitle}!`,
      templateName: 'purchaseConfirmation', // Nombre de la plantilla sin .html
      data: { // Objeto con todos los datos para la plantilla
        name: name,
        courseTitle: courseTitle,
        phone: phone
      }
    });

    // 2. Enviar WhatsApp de confirmación
    await sendWhatsAppMessage({ to: phone, name: name, courseTitle: courseTitle });

    res.status(200).json({ message: 'Notificaciones enviadas exitosamente.' });

  } catch (error) {
    console.error('Error al enviar notificaciones:', error);
    res.status(500).json({ message: 'Error interno al procesar las notificaciones.' });
  }
};

export default sendPurchaseNotification;