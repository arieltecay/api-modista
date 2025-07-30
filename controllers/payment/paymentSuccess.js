
import dotenv from 'dotenv';
dotenv.config();

import { MercadoPagoConfig, Payment } from 'mercadopago';

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });

export const paymentSuccess = async (req, res) => {
  const { payment_id, status, external_reference, merchant_order_id } = req.query;  // Estos datos vienen de Mercado Pago
  let courseData = null; // Cambiado de courseTitle a courseData

  try {
    if (payment_id) {
      const payment = new Payment(client);
      const paymentDetails = await payment.get({ id: payment_id });
      // Verificar si paymentDetails y paymentDetails.metadata.course existen
      if (paymentDetails && paymentDetails.metadata && paymentDetails.metadata.course) {
        courseData = paymentDetails.metadata.course; // Asignar el objeto course completo
      }
    }
  } catch (error) {
    console.error('Error al obtener detalles del pago de Mercado Pago:', error);
    // Continuar si hay un error, courseData seguirá siendo null
  }

  if (!courseData) { // Cambiado de courseTitle === 'No disponible' a !courseData
    console.error('Error: No se pudo obtener los datos del curso para external_reference:', external_reference);
    return res.redirect(`${process.env.CORS_ORIGIN}/payment/failure?error=no_course_data`); // Redirigir con error
  }

  // 2. Redirigir al frontend con los datos del curso como parámetros
  const redirectURL = `${process.env.CORS_ORIGIN}/payment/success?` +
                      `payment_id=${payment_id}&` +
                      `status=${status}&` +
                      `merchant_order_id=${merchant_order_id}&` +
                      `courseTitle=${encodeURIComponent(courseData.title)}&` +
                      `courseShortDescription=${encodeURIComponent(courseData.shortDescription)}&` +
                      `coursePrice=${encodeURIComponent(courseData.price)}`;
  console.log('Redirigiendo al frontend:', redirectURL);
  res.redirect(redirectURL);
};