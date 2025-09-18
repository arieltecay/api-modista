import express, { Router, Request, Response } from 'express';
import { sendEmail } from '../../services/emailServices.js';

const router: Router = express.Router();

// Interface para el body del email
interface SendEmailBody {
  to: string;
  subject: string;
  templateName: string;
  data: {
    name: string;
    [key: string]: any;
  };
}

router.post('/send-email', async (req: Request<{}, {}, SendEmailBody>, res: Response): Promise<void> => {
  try {
    const { to, subject, templateName, data } = req.body;

    // Validar que los datos necesarios estén presentes
    if (!to || !subject || !templateName || !data || !data.name) {
      res.status(400).json({ error: 'Faltan datos necesarios para enviar el correo.' });
      return;
    }

    await sendEmail({ to, subject, templateName, data });
    res.status(200).json({ message: 'Correo de prueba enviado/simulado exitosamente.' });
  } catch (error) {
    console.error('Error al enviar correo de prueba:', error);
    res.status(500).json({ error: 'Error interno del servidor al enviar correo de prueba.' });
  }
});

export default router;
