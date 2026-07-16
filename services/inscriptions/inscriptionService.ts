import Inscription from '../../models/Inscription.js';
import { validateInscriptionData } from './inscriptionValidator.js';
import { sendEmail } from '../../services/emailServices.js';
import { InscriptionBody, CreateInscriptionResult } from './types.js';
import { fireMetaEvent, buildEventId } from '../../services/meta-capi-helpers/index.js';
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
  // IMPORTANTE: Cada evento debe tener un event_id único (prefijado por tipo)
  // para que Meta pueda deduplicar correctamente entre el Pixel del navegador
  // y el CAPI del servidor sin descartar eventos distintos.
  const inscriptionId = inscription._id.toString();
  try {
    if (!inscription.metaLeadFiredAt) {
      const okLead = await fireMetaEvent({
        eventName: 'Lead',
        email: inscription.email,
        phone: inscription.celular,
        firstName: inscription.nombre,
        lastName: inscription.apellido,
        value: inscription.coursePrice,
        contentName: inscription.courseTitle,
        contentIds: [inscription.courseId],
        eventId: buildEventId('lead', inscriptionId),
        fbc: inscription.metaFbc,
        fbp: inscription.metaFbp,
        clientIpAddress: inscription.clientIpAddress,
        clientUserAgent: inscription.clientUserAgent
      });
      if (okLead) {
        inscription.metaLeadFiredAt = new Date();
      }
    }

    if (!inscription.metaInitiateCheckoutFiredAt) {
      const okCheck = await fireMetaEvent({
        eventName: 'InitiateCheckout',
        email: inscription.email,
        phone: inscription.celular,
        firstName: inscription.nombre,
        lastName: inscription.apellido,
        value: inscription.coursePrice,
        contentName: inscription.courseTitle,
        contentIds: [inscription.courseId],
        eventId: buildEventId('checkout', inscriptionId),
        fbc: inscription.metaFbc,
        fbp: inscription.metaFbp,
        clientIpAddress: inscription.clientIpAddress,
        clientUserAgent: inscription.clientUserAgent
      });
      if (okCheck) {
        inscription.metaInitiateCheckoutFiredAt = new Date();
      }
    }
    
    await inscription.save();
  } catch (capiError) {
    console.error('[Meta CAPI Lead/InitiateCheckout Error]:', capiError);
  }

  // Enviar email de confirmación con link de pago
  // El link incluye UTMs para que si el usuario regresa desde el email,
  // el sistema lo atribuya como tráfico de email y no como direct.
  try {
    const rawPaymentLink = validation.resolvedCourse!.mpPaymentLink || '';
    const trackedPaymentLink = rawPaymentLink
      ? `${rawPaymentLink}${rawPaymentLink.includes('?') ? '&' : '?'}utm_source=email&utm_medium=email&utm_campaign=payment_reminder`
      : rawPaymentLink;

    await sendEmail({
      to: inscription.email,
      subject: `Confirmación de tu Inscripción - ${inscription.courseTitle}`,
      templateName: 'teamplate',
      data: {
        name: `${inscription.nombre} ${inscription.apellido}`,
        courseTitle: inscription.courseTitle,
        price: inscription.coursePrice.toString(),
        paymentLink: trackedPaymentLink,
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
