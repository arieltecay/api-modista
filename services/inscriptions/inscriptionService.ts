import Inscription from '../../models/Inscription.js';
import { validateInscriptionData } from './inscriptionValidator.js';
import { sendEmail } from '../../services/emailServices.js';
import { InscriptionBody, CreateInscriptionResult } from './types.js';
import { sendMetaConversionEvent } from '../../services/meta-capi-service.js';

export const createInscription = async (body: InscriptionBody): Promise<CreateInscriptionResult> => {
  const validation = await validateInscriptionData(body);
  
  if (!validation.valid) {
    const error = validation.error!;
    const err = new Error(error.message) as any;
    err.statusCode = error.status;
    throw err;
  }

  const inscriptionData = {
    ...body,
    courseId: validation.finalCourseId,
  };

  const inscription = await Inscription.create(inscriptionData);

  // --- Meta CAPI: Lead & InitiateCheckout ---
  try {
    // Evento de Lead (Conversión principal para optimización de campañas de captación)
    sendMetaConversionEvent({
      eventName: 'Lead',
      email: inscription.email,
      phone: inscription.celular,
      firstName: inscription.nombre,
      lastName: inscription.apellido,
      value: inscription.coursePrice,
      contentName: inscription.courseTitle,
      orderId: inscription._id.toString(),
      fbc: inscription.metaFbc,
      fbp: inscription.metaFbp,
      clientIpAddress: inscription.clientIpAddress,
      clientUserAgent: inscription.clientUserAgent
    });

    // Evento de InitiateCheckout (Progreso en el funnel)
    sendMetaConversionEvent({
      eventName: 'InitiateCheckout',
      email: inscription.email,
      phone: inscription.celular,
      firstName: inscription.nombre,
      lastName: inscription.apellido,
      value: inscription.coursePrice,
      contentName: inscription.courseTitle,
      orderId: inscription._id.toString(),
      fbc: inscription.metaFbc,
      fbp: inscription.metaFbp,
      clientIpAddress: inscription.clientIpAddress,
      clientUserAgent: inscription.clientUserAgent
    });
  } catch (capiError) {
    console.error('[Meta CAPI Lead Error]:', capiError);
  }

  // Enviar email de confirmación con link de pago
  try {
    await sendEmail({
      to: inscription.email,
      subject: `Confirmación de tu Inscripción - ${inscription.courseTitle}`,
      templateName: 'teamplate',
      data: {
        name: `${inscription.nombre} ${inscription.apellido}`,
        courseTitle: inscription.courseTitle,
        price: inscription.coursePrice.toString(),
        paymentLink: validation.resolvedCourse!.mpPaymentLink || '',
        year: new Date().getFullYear().toString(),
      },
    });
  } catch (err) {
    console.error('Error sending confirmation email:', err);
  }

  return {
    success: true,
    data: inscription,
    mpPaymentLink: validation.resolvedCourse!.mpPaymentLink || null,
  };
};
