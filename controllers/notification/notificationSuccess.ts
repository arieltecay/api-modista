
import { Request, Response } from 'express';
import { sendEmail } from '../../services/emailServices.js';
import { sendWhatsAppMessage } from '../../services/whatsAppService.js';

interface PurchaseNotificationBody {
  name: string;
  email: string;
  phone: string;
  courseTitle: string;
}

export const sendPurchaseNotification = async (req: Request<{}, {}, PurchaseNotificationBody>, res: Response) => {
  const { name, email, phone, courseTitle } = req.body;

  if (!name || !email || !phone || !courseTitle) {
    return res.status(400).json({ message: 'Todos los campos son requeridos.' });
  }

  try {
    // 1. Enviar Email de confirmación
    await sendEmail({
      to: email,
      subject: `¡Confirmación de tu compra: ${courseTitle}!`,
      templateName: 'paymentSuccess',
      data: {
        name: name,
        courseTitle: courseTitle,
        phone: phone,
        email: email
      }
    });

    // 2. Enviar WhatsApp de confirmación
    await sendWhatsAppMessage({
      to: phone,
      templateName: 'compra_exitosa', // Asumiendo que esta es la plantilla correcta
      data: {
        name: name,
        courseTitle: courseTitle
      }
    });

    res.status(200).json({ message: 'Notificaciones enviadas exitosamente.' });

  } catch (error) {
    console.error('Error al enviar notificaciones:', error);
    res.status(500).json({ message: 'Error interno al procesar las notificaciones.' });
  }
};

export default sendPurchaseNotification;
