import { MercadoPagoConfig, Payment } from 'mercadopago';
import dotenv from 'dotenv';

dotenv.config();

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const payment = new Payment(client);

/**
 * Maneja la redirección de éxito de Mercado Pago.
 * Crea una cookie segura y redirige al frontend.
 */
export const paymentSuccess = (req, res) => {
  const { external_reference } = req.query;

  if (!external_reference) {
    return res.status(400).send('Falta la referencia externa');
  }

  // 1. Crear cookie segura con la referencia externa
  res.cookie('payment_ref', external_reference, {
    httpOnly: true, // Impide acceso desde JS en el navegador
    secure: process.env.NODE_ENV === 'production', // Solo en HTTPS
    sameSite: 'Lax', // Protección CSRF
    path: '/api/payment', // Alcance de la cookie
    maxAge: 300000, // 5 minutos de vida
  });

  // 2. Redirigir al usuario a la página de éxito del frontend
  res.redirect(`${process.env.CORS_ORIGIN}/payment/success`);
};

/**
 * El frontend llama a esta ruta para obtener los datos del pago.
 * Verifica la cookie, consulta a Mercado Pago y devuelve los datos.
 */
export const getVerifiedPaymentData = async (req, res) => {
  const { payment_ref } = req.cookies;

  if (!payment_ref) {
    return res.status(401).json({ message: 'No autorizado: Referencia de pago no encontrada.' });
  }

  try {
    // 3. Buscar el pago en Mercado Pago usando la external_reference
    const searchResult = await payment.search({
      options: {
        external_reference: payment_ref,
        sort: 'date_created',
        criteria: 'desc',
      },
    });

    const paymentResult = searchResult.results?.[0];

    if (!paymentResult || paymentResult.status !== 'approved') {
      // Limpiar la cookie si el pago no se encuentra o no está aprobado
      res.clearCookie('payment_ref', { path: '/api/payment' });
      return res.status(404).json({ message: 'Pago no encontrado o no aprobado.' });
    }

    // 4. Extraer los metadatos del curso y el estado del pago
    const courseData = paymentResult.metadata.course;
    const paymentStatus = paymentResult.status;
    const paymentId = paymentResult.id;

    // 5. ¡Importante! Limpiar la cookie después de usarla para que no se reutilice
    res.clearCookie('payment_ref', { path: '/api/payment' });

    // 6. Enviar los datos verificados al frontend
    res.status(200).json({
      course: courseData,
      payment: {
        id: paymentId,
        status: paymentStatus,
      },
    });
  } catch (error) {
    console.error('Error al verificar el pago con Mercado Pago:', error);
    res.clearCookie('payment_ref', { path: '/api/payment' });
    res.status(500).json({ message: 'Error al verificar el pago.' });
  }
};
