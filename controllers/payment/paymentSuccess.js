import dotenv from 'dotenv';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';

dotenv.config();

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });

// Caché en memoria para almacenar temporalmente los datos de pagos verificados.
// En un entorno de producción real, considera usar una solución más robusta como Redis.
const verifiedPayments = {};

export const paymentSuccess = async (req, res) => {
  const { payment_id, status } = req.query;

  // 1. Validar que el estado sea 'approved'
  if (status !== 'approved') {
    return res.redirect(`${process.env.CORS_ORIGIN}/payment/failure?reason=payment_not_approved`);
  }

  try {
    // 2. Obtener detalles del pago de Mercado Pago para verificar la autenticidad
    const payment = new Payment(client);
    const paymentDetails = await payment.get({ id: payment_id });

    if (!paymentDetails || !paymentDetails.metadata || !paymentDetails.metadata.course) {
      console.error('Error: No se pudieron obtener los metadatos del curso desde Mercado Pago.');
      return res.redirect(`${process.env.CORS_ORIGIN}/payment/failure?reason=metadata_missing`);
    }

    const courseData = paymentDetails.metadata.course;

    // 3. Generar un token seguro y de un solo uso
    const token = crypto.randomUUID();

    // 4. Guardar los datos del pago verificado en el caché en memoria
    verifiedPayments[token] = {
      courseData,
      timestamp: Date.now(),
    };

    // 5. Limpiar el token del caché después de 5 minutos para evitar que se acumulen
    setTimeout(() => {
      delete verifiedPayments[token];
    }, 5 * 60 * 1000);

    // 6. Redirigir al frontend, estableciendo el token en una cookie segura
    res.cookie('payment_token', token, {
      httpOnly: true, // Impide acceso desde JavaScript en el cliente
      secure: process.env.NODE_ENV === 'production', // Usar solo en HTTPS en producción
      sameSite: 'Strict', // Mitiga ataques CSRF
      maxAge: 5 * 60 * 1000, // La cookie expira en 5 minutos
      path: '/',
    });

    res.redirect(`${process.env.CORS_ORIGIN}/payment/success`);

  } catch (error) {
    console.error('Error al verificar el pago de Mercado Pago:', error);
    res.redirect(`${process.env.CORS_ORIGIN}/payment/failure?reason=verification_failed`);
  }
};

export const getVerifiedPaymentData = (req, res) => {
  const { payment_token } = req.cookies;

  if (!payment_token) {
    return res.status(401).json({ error: 'No autorizado: Token de pago no proporcionado.' });
  }

  const paymentInfo = verifiedPayments[payment_token];

  if (paymentInfo) {
    // El token es válido, se entregan los datos y se invalida el token.
    delete verifiedPayments[payment_token]; // Invalida el token para que sea de un solo uso
    
    // Limpiar la cookie en el cliente
    res.clearCookie('payment_token', { path: '/' });

    res.status(200).json(paymentInfo.courseData);
  } else {
    // El token no es válido o ha expirado
    res.status(404).json({ error: 'Datos de pago no encontrados o la sesión ha expirado.' });
  }
};