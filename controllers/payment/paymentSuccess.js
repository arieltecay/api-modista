
import dotenv from 'dotenv';
dotenv.config();

import { MercadoPagoConfig, Payment } from 'mercadopago';

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });

export const paymentSuccess = async (req, res) => {
  const { payment_id, status, external_reference, merchant_order_id } = req.query;  // Estos datos vienen de Mercado Pago
  let courseTitle = 'No disponible';

  try {
    if (payment_id) {
      const payment = new Payment(client);
      const paymentDetails = await payment.get({ id: payment_id });
      if (paymentDetails && paymentDetails.metadata && paymentDetails.metadata.courseTitle) {
        courseTitle = paymentDetails.metadata.courseTitle;
      }
    }
  } catch (error) {
    console.error('Error al obtener detalles del pago de Mercado Pago:', error);
    // Continuar con 'No disponible' si hay un error
  }

  if (courseTitle === 'No disponible') {
    console.error('Error: No se pudo obtener courseTitle para external_reference:', external_reference);
    return res.redirect(`${process.env.CORS_ORIGIN}/payment-failure?error=no_course_title`); // Redirigir con error
  }

  // 2. Redirigir al frontend con el course_title como parámetro
  const redirectURL = `${process.env.CORS_ORIGIN}/payment-success?course_title=${encodeURIComponent(courseTitle)}&payment_id=${payment_id}&status=${status}&merchant_order_id=${merchant_order_id}`;
  console.log('Redirigiendo al frontend:', redirectURL);
  res.redirect(redirectURL);
};