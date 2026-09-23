import Inscription from '../../models/Inscription.js';
import { validateInscriptionData } from './inscriptionValidator.js';
import { sendEmail } from '../../services/emailServices.js';
import { fireMetaEvent, buildEventId } from '../../services/meta-capi-helpers/index.js';
import { mpPreference, isMercadoPagoConfigured } from '../../services/payments/mpClient.js';
import { getGeoLocationFromIp } from '../geolocation/index.js';
import { logger } from '../../services/logger.js';
import { InscriptionBody, CreateInscriptionResult } from './types.js';

const getFrontendUrl = (): string => {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/+$/, '');
  const corsOrigin = process.env.CORS_ORIGIN?.split(',')[0];
  return (corsOrigin || 'http://localhost:5173').replace(/\/+$/, '');
};

const getNotificationUrl = (): string => {
  const base = process.env.MP_NOTIFICATION_URL || process.env.VITE_API_URL || 'http://localhost:3001';
  // Normalizar: quitar slashes finales y el path del webhook si alguien lo incluyó en la env.
  const cleanBase = base.replace(/\/+$/, '').replace(/\/api\/payment\/webhook$/, '');
  return `${cleanBase}/api/payment/webhook`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Contexto CAPI compartido por Lead e InitiateCheckout (antes se repetía dos
 * veces dentro del service). Una sola función, una sola fuente de verdad del
 * match de datos que recibe Meta.
 */
const buildInscriptionCapiContext = (
  inscription: any,
  coursePrice: number,
  courseTitle: string,
  inscriptionId: string,
  eventSourceUrl?: string
) => {
  const geo = getGeoLocationFromIp(inscription.clientIpAddress || '');
  return {
    email: inscription.email,
    phone: inscription.celular,
    firstName: inscription.nombre,
    lastName: inscription.apellido,
    value: coursePrice,
    contentName: courseTitle,
    contentIds: [inscription.courseId] as string[],
    externalId: inscriptionId,
    fbc: inscription.metaFbc,
    fbp: inscription.metaFbp,
    clientIpAddress: inscription.clientIpAddress,
    clientUserAgent: inscription.clientUserAgent,
    city: geo.city,
    country: geo.country,
    eventSourceUrl: eventSourceUrl || inscription.eventSourceUrl,
  };
};

export const createInscription = async (body: InscriptionBody): Promise<CreateInscriptionResult> => {
  const validation = await validateInscriptionData(body);

  if (!validation.valid) {
    const err = new Error(validation.error.message) as Error & { statusCode: number };
    err.statusCode = validation.error.status;
    throw err;
  }

  // Fuente de verdad: precio/título del curso vienen de la DB (anti price-tampering),
  // email normalizado a lowercase para deduplicación correcta.
  const { trustedCoursePrice: coursePrice, trustedCourseTitle: courseTitle, normalizedEmail } = validation;

  const inscriptionData: InscriptionBody = {
    ...body,
    email: normalizedEmail,
    courseTitle,
    coursePrice,
    courseId: validation.finalCourseId,
  };
  const eventSourceUrl = body.eventSourceUrl;

  const inscription = await Inscription.create(inscriptionData).catch((createError: unknown) => {
    // Race de dos requests simultáneos con el mismo email → índice único (E11000)
    if ((createError as { code?: number })?.code === 11000) {
      const err = new Error('Ya te encuentras inscripto en este curso con este email.') as Error & { statusCode: number };
      err.statusCode = 409;
      throw err;
    }
    throw createError;
  });

  const inscriptionId = inscription._id.toString();

  // --- Meta CAPI: Lead & InitiateCheckout ---
  // Los flags se persisten con updateOne (NUNCA save() sobre el doc en memoria):
  // evita el VersionError por concurrencia con el save() que persiste mpPreferenceId.
  const fireCapiEvents = async (): Promise<void> => {
    const base = buildInscriptionCapiContext(inscription, coursePrice, courseTitle, inscriptionId, eventSourceUrl);
    const flagsToSet: Record<string, Date> = {};

    if (!inscription.metaLeadFiredAt) {
      const okLead = await fireMetaEvent({
        eventName: 'Lead',
        eventId: buildEventId('lead', inscriptionId),
        ...base,
      });
      if (okLead) flagsToSet.metaLeadFiredAt = new Date();
    }

    if (!inscription.metaInitiateCheckoutFiredAt) {
      const okCheck = await fireMetaEvent({
        eventName: 'InitiateCheckout',
        eventId: buildEventId('checkout', inscriptionId),
        ...base,
      });
      if (okCheck) flagsToSet.metaInitiateCheckoutFiredAt = new Date();
    }

    if (Object.keys(flagsToSet).length > 0) {
      await Inscription.updateOne({ _id: inscription._id }, { $set: flagsToSet });
    }
  };

  // Corre en paralelo con la creación de la preference de MP.
  const capiPromise = fireCapiEvents().catch((capiError) => {
    logger.error('[Meta CAPI Lead/InitiateCheckout Error]:', capiError);
  });

  // --- Crear preference dinamica de MercadoPago ---
  let mpInitPoint: string | null = null;
  let sandboxInitPoint: string | null = null;
  let mpPreferenceId: string | null = null;
  let activePaymentLink: string | null = validation.resolvedCourse!.mpPaymentLink || null;

  // Cursos gratuitos (price <= 0) no generan checkout de MP.
  if (isMercadoPagoConfigured() && coursePrice > 0) {
    try {
      const frontendUrl = getFrontendUrl();
      const notificationUrl = getNotificationUrl();

      const response = await mpPreference.create({
        body: {
          items: [
            {
              id: inscription.courseId,
              title: courseTitle,
              description: `Inscripcion al curso: ${courseTitle}`,
              unit_price: Number(coursePrice),
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
            course_title: courseTitle,
          },
        },
      });

      mpInitPoint = response.init_point ?? null;
      sandboxInitPoint = response.sandbox_init_point ?? null;
      mpPreferenceId = String(response.id);
      activePaymentLink = null;
      inscription.mpPreferenceId = mpPreferenceId;

      // Persistimos mpPreferenceId con el doc en memoria (su __v no fue tocado por los updateOne)
      await inscription.save();
    } catch (mpError) {
      logger.error('[createInscription] No se pudo crear preference de MP, usando fallback mpPaymentLink', mpError);
    }
  } else if (coursePrice <= 0) {
    logger.info(`[createInscription] Curso gratuito (${inscription.courseId}), sin preference de MP`);
  } else {
    logger.warn('[createInscription] MP no configurado, usando course.mpPaymentLink como fallback');
  }

  // Enviar email de confirmacion con link de pago.
  // Prioridad: preference dinamica > fallback estatico del curso.
  const sendConfirmationEmail = async () => {
    try {
      const effectiveLink = sandboxInitPoint || mpInitPoint || activePaymentLink;
      const trackedPaymentLink = effectiveLink
        ? `${effectiveLink}${effectiveLink.includes('?') ? '&' : '?'}utm_source=email&utm_medium=email&utm_campaign=payment_reminder`
        : '';

      await sendEmail({
        to: inscription.email,
        subject: `Confirmacion de tu Inscripcion - ${courseTitle}`,
        templateName: 'teamplate',
        data: {
          name: `${inscription.nombre} ${inscription.apellido}`,
          courseTitle: courseTitle,
          price: coursePrice.toString(),
          paymentLink: trackedPaymentLink,
          year: new Date().getFullYear().toString(),
        },
      });
    } catch (err) {
      logger.error('[createInscription] Error sending confirmation email:', err);
    }
  };

  const emailPromise = sendConfirmationEmail().catch((err) => {
    logger.error('[createInscription] Error sending confirmation email:', err);
  });

  // Serverless-safe: esperamos a que los side-effects terminen ANTES de responder
  // (Vercel congela la función tras la respuesta), con un cap de 4s para no
  // degradar la UX si Meta o SMTP están lentos.
  await Promise.race([
    Promise.allSettled([capiPromise, emailPromise]),
    sleep(4000),
  ]);

  return {
    success: true,
    data: inscription,
    mpPaymentLink: activePaymentLink,
    mpInitPoint,
    sandboxInitPoint,
    mpPreferenceId,
  };
};
