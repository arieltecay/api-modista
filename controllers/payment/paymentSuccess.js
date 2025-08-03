import { MercadoPagoConfig, Payment } from 'mercadopago';
import dotenv from 'dotenv';

dotenv.config();

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
const payment = new Payment(client);

export const paymentSuccess = (req, res) => {
  const { external_reference } = req.query;

  if (!external_reference) {
    return res.status(400).send('Falta la referencia externa');
  }

  res.cookie('payment_ref', external_reference, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/api', // SOLUCIÓN: Path más general para la cookie
    maxAge: 300000, // 5 minutos
  });

  res.redirect(`${process.env.CORS_ORIGIN}/payment/success`);
};

export const getVerifiedPaymentData = async (req, res) => {
  console.log('--- Iniciando verificación de pago ---');
  console.log('Cookies recibidas:', req.cookies); // LOG: Muestra todas las cookies

  const { payment_ref } = req.cookies;

  if (!payment_ref) {
    console.error('Error: No se encontró la cookie `payment_ref`.');
    return res.status(401).json({ message: 'No autorizado: Referencia de pago no encontrada.' });
  }

  console.log('Referencia de pago encontrada:', payment_ref);

  // Definir la ruta de la cookie para poder limpiarla correctamente
  const cookieOptions = { path: '/api' };

  try {
    console.log('Buscando pago en Mercado Pago...');
    const searchResult = await payment.search({
      options: {
        external_reference: payment_ref,
        sort: 'date_created',
        criteria: 'desc',
      },
    });

    console.log('Respuesta de Mercado Pago:', JSON.stringify(searchResult, null, 2)); // LOG: Muestra la respuesta completa de MP

    const paymentResult = searchResult.results?.[0];

    if (!paymentResult || paymentResult.status !== 'approved') {
      console.warn('Advertencia: Pago no encontrado o no aprobado. Estado:', paymentResult?.status);
      res.clearCookie('payment_ref', cookieOptions);
      return res.status(404).json({ message: 'Pago no encontrado o no aprobado.' });
    }

    console.log('Pago aprobado encontrado. ID:', paymentResult.id);
    const courseData = paymentResult.metadata.course;
    const paymentStatus = paymentResult.status;
    const paymentId = paymentResult.id;

    console.log('Limpiando cookie y enviando datos al frontend.');
    res.clearCookie('payment_ref', cookieOptions);

    res.status(200).json({
      course: courseData,
      payment: {
        id: paymentId,
        status: paymentStatus,
      },
    });

  } catch (error) {
    console.error('Error crítico al verificar el pago con Mercado Pago:', error);
    res.clearCookie('payment_ref', cookieOptions);
    res.status(500).json({ message: 'Error interno al verificar el pago.' });
  }
};
