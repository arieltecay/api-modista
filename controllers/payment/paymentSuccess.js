// controllers/paymentController.js

export const paymentSuccess = (req, res) => {
  // 1. Extraer course_title del query string. Mercado Pago NO lo envía, así que lo debemos mantener en "sesión".
  const { payment_id, status, external_reference, merchant_order_id } = req.query;  // Estos datos vienen de Mercado Pago
  const courseTitles = req.app.get('courseTitles');
  const courseTitle = courseTitles[external_reference]; //  Recuperar de la "sesión".  Necesitamos pasar el ID de preferencia como external_reference.

  if (!courseTitle) {
    console.error('Error: No se encontró courseTitle en la "sesión" para external_reference:', external_reference);
    return res.redirect(`http://localhost:5173/payment-failure?error=no_course_title`); // Redirigir con error
  }

  // 2. Redirigir al frontend con el course_title como parámetro
  const redirectURL = `http://localhost:5173/payment-success?course_title=${encodeURIComponent(courseTitle)}&payment_id=${payment_id}&status=${status}&merchant_order_id=${merchant_order_id}`;
  console.log('Redirigiendo al frontend:', redirectURL);
  res.redirect(redirectURL);
};