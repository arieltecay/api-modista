import Inscription from '../../models/Inscription.js';
import { validateInscriptionData } from './inscriptionValidator.js';
import { sendEmail } from '../../services/emailServices.js';
import { fireMetaEvent, buildEventId } from '../../services/meta-capi-helpers/index.js';
import { mpPreference, isMercadoPagoConfigured } from '../../services/payments/mpClient.js';
import { logger } from '../../services/logger.js';
import { InscriptionBody, CreateInscriptionResult } from './types.js';

const getFrontendUrl = (): string => {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');
  const corsOrigin = process.env.CORS_ORIGIN?.split(',')[0];
  return (corsOrigin || 'http://localhost:5173').replace(/\/+$/, '');
};

const getNotificationUrl = (): string => {
  const base = process.env.MP_NOTIFICATION_URL || process.env.VITE_API_URL || 'http://localhost:3001';
  return `${base.replace(/\/+$/, '')}/api/payment/webhook`;
};

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
  const inscriptionId = inscription._id.toString();

  // --- Meta CAPI: Lead & InitiateCheckout (fire-and-forget, NO bloquean la respuesta) ---
  const fireCapiEvents = async () => {
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
  };

  // Disparamos CAPI en background — el usuario NO espera esto
  fireCapiEvents().catch(() => {});

  // --- Crear preference dinamica de MercadoPago ---
  let mpInitPoint: string | null = null;
  let sandboxInitPoint: string | null = null;
  let mpPreferenceId: string | null = null;
  let activePaymentLink: string | null = validation.resolvedCourse!.mpPaymentLink || null;

  if (isMercadoPagoConfigured()) {
    try {
      const frontendUrl = getFrontendUrl();
      const notificationUrl = getNotificationUrl();

      const response = await mpPreference.create({
        body: {
          items: [
            {
              id: inscription.courseId,
              title: inscription.courseTitle,
              description: `Inscripcion al curso: ${inscription.courseTitle}`,
              unit_price: Number(inscription.coursePrice),
              quantity: 1,
              currency_id: 'ARS',
            },
          ],
          external_reference: inscriptionId,
          back_urls: {
            success: `${frontendUrl}/payment/success?inscription_id=${inscriptionId}`,
            failure: `${frontendUrl}/payment/failure?inscription_id=${inscriptionId}`,
            pending: `${frontendUrl}/payment/pending?inscription_id=${inscriptionId}`,
          },
          auto_return: 'approved',
          notification_url: notificationUrl,
          metadata: {
            inscription_id: inscriptionId,
            course_title: inscription.courseTitle,
          },
        },
      });

      mpInitPoint = response.init_point ?? null;
      sandboxInitPoint = response.sandbox_init_point ?? null;
      mpPreferenceId = String(response.id);
      activePaymentLink = null;
      inscription.mpPreferenceId = mpPreferenceId;
    } catch (mpError) {
      logger.error('[createInscription] No se pudo crear preference de MP, usando fallback mpPaymentLink', mpError);
    }
  } else {
    logger.warn('[createInscription] MP no configurado, usando course.mpPaymentLink como fallback');
  }

  // Guardar TODOS los cambios acumulados en UNA sola escritura
  await inscription.save();

  // Enviar email de confirmacion con link de pago (fire-and-forget)
  // Prioridad: preference dinamica > fallback estatico del curso
  const sendConfirmationEmail = async () => {
    try {
      const effectiveLink = sandboxInitPoint || mpInitPoint || activePaymentLink;
      const trackedPaymentLink = effectiveLink
        ? `${effectiveLink}${effectiveLink.includes('?') ? '&' : '?'}utm_source=email&utm_medium=email&utm_campaign=payment_reminder`
        : '';

      await sendEmail({
        to: inscription.email,
        subject: `Confirmacion de tu Inscripcion - ${inscription.courseTitle}`,
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
  };

  sendConfirmationEmail().catch(() => {});

  return {
    success: true,
    data: inscription,
    mpPaymentLink: activePaymentLink,
    mpInitPoint,
    sandboxInitPoint,
    mpPreferenceId,
  };
};
