import { Request, Response } from 'express';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import dotenv from 'dotenv';

dotenv.config();

const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
if (!accessToken) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN is not defined');
}
const client = new MercadoPagoConfig({ accessToken });
const payment = new Payment(client);

// Interface para query de paymentSuccess
interface PaymentSuccessQuery {
  external_reference: string;
}

export const paymentSuccess = (req: Request<{}, {}, {}, PaymentSuccessQuery>, res: Response): void => {
  const { external_reference } = req.query;

  if (!external_reference) {
    res.status(400).send('Falta la referencia externa');
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // SOLUCIÓN DEFINITIVA: Configura la cookie para producción (Vercel)
  res.cookie('payment_ref', external_reference, {
    httpOnly: true,
    secure: isProduction, // Requerido para SameSite=None
    sameSite: isProduction ? 'none' : 'lax', // 'none' para cross-site, 'lax' para local
    path: '/api', // Path general para la API
    maxAge: 300000, // 5 minutos
  });

  res.redirect(`${process.env.CORS_ORIGIN}/payment/success`);
};

export const getVerifiedPaymentData = async (req: Request, res: Response): Promise<void> => {
  console.log('--- Iniciando verificación de pago ---');
  console.log('Cookies recibidas:', req.cookies);

  const { payment_ref } = req.cookies;

  if (!payment_ref) {
    console.error('Error: No se encontró la cookie `payment_ref`.');
    res.status(401).json({ message: 'No autorizado: Referencia de pago no encontrada.' });
    return;
  }

  console.log('Referencia de pago encontrada:', payment_ref);

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api',
  };

  try {
    console.log('Buscando pago en Mercado Pago...');
    const searchResult = await payment.search({
      options: {
        external_reference: payment_ref,
        sort: 'date_created',
        criteria: 'desc',
      },
    });

    console.log('Respuesta de Mercado Pago:', JSON.stringify(searchResult, null, 2));

    const paymentResult = searchResult.results?.[0];

    if (!paymentResult || paymentResult.status !== 'approved') {
      console.warn('Advertencia: Pago no encontrado o no aprobado. Estado:', paymentResult?.status);
      res.clearCookie('payment_ref', cookieOptions);
      res.status(404).json({ message: 'Pago no encontrado o no aprobado.' });
      return;
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
