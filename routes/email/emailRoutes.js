import express from 'express';
import { sendEmail } from '../../services/emailServices.js';

const router = express.Router();

router.post('/send-test-email', async (req, res) => {
  try {
    const { to, subject, templateName, data } = req.body;

    // Validar que los datos necesarios estén presentes
    if (!to || !subject || !templateName || !data || !data.name) {
      return res.status(400).json({ error: 'Faltan datos necesarios para enviar el correo.' });
    }

    await sendEmail({ to, subject, templateName, data });
    res.status(200).json({ message: 'Correo de prueba enviado/simulado exitosamente.' });
  } catch (error) {
    console.error('Error al enviar correo de prueba:', error);
    res.status(500).json({ error: 'Error interno del servidor al enviar correo de prueba.' });
  }
});

export default router;
