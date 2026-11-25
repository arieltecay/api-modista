import Inscription from '../../models/Inscription.js';
import { validateInscriptionData } from './inscriptionValidator.js';
import { sendEmail } from '../../services/emailServices.js';
import { fireMetaEvent, buildEventId } from '../../services/meta-capi-helpers/index.js';
import { mpPreference, isMercadoPagoConfigured } from '../../services/payments/mpClient.js';
import { getGeoLocationFromIp } from '../geolocation/index.js';
import { logger } from '../../services/logger.js';
import { InscriptionBody, CreateInscriptionResult } from './types.js';
import { META_MARKETING_CONSENT_VERSION } from '../../utils/metaMarketingConsent.js';
import { claimSeat, mercadoPagoExpiration, newReservationEnd } from '../Coupons/reservation.js';
import { couponNotValidError, priceInscription } from './couponPricing.js';
import { publicInscriptionView, repriceExistingInscription } from './repricing.js';
import { confirmationPaymentLink } from './confirmationPaymentLink.js';

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
    marketingConsent: inscription.metaMarketingConsent === true,
    email: inscription.email,
    phone: inscription.celular,
    firstName: inscription.nombre,
    lastName: inscription.apellido,
    value: coursePrice,
    contentName: courseTitle,
    contentIds: [inscription.courseId] as string[],
    externalId: inscription.sessionId,
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
  const { trustedCourseTitle: courseTitle, normalizedEmail } = validation;
  // El precio final (con cupón si aplica) lo decide el servidor; los campos de cupón del body se descartan.
  const { coursePrice, hasCoupon, couponFields } = await priceInscription(body.couponCode, {
    courseId: validation.finalCourseId,
    price: validation.trustedCoursePrice,
  });
  const metaMarketingConsent = body.metaMarketingConsent === true;

  const inscriptionData: InscriptionBody = {
    ...body,
    email: normalizedEmail,
    courseTitle,
    coursePrice,
    courseId: validation.finalCourseId,
    ...couponFields,
    metaMarketingConsent,
    metaMarketingConsentAt: metaMarketingConsent ? body.metaMarketingConsentAt ?? new Date() : undefined,
    metaMarketingConsentVersion: metaMarketingConsent ? META_MARKETING_CONSENT_VERSION : undefined,
    sessionId: metaMarketingConsent ? body.sessionId : undefined,
    metaFbc: metaMarketingConsent ? body.metaFbc : undefined,
    metaFbp: metaMarketingConsent ? body.metaFbp : undefined,
    clientIpAddress: metaMarketingConsent ? body.clientIpAddress : undefined,
    clientUserAgent: metaMarketingConsent ? body.clientUserAgent : undefined,
    eventSourceUrl: metaMarketingConsent ? body.eventSourceUrl : undefined,
  };
  const eventSourceUrl = body.eventSourceUrl;

  const createNewInscription = () =>
    Inscription.create(inscriptionData).catch((createError: unknown) => {
      // Race de dos requests simultáneos con el mismo email → índice único (E11000)
      if ((createError as { code?: number })?.code === 11000) {
        const err = new Error('Ya te encuentras inscripto en este curso con este email.') as Error & { statusCode: number };
        err.statusCode = 409;
        throw err;
      }
      throw createError;
    });

  // Una inscripción sin pagar que vuelve con un cupón nuevo conserva su id y sus datos: solo cambia el precio.
  const repriced = validation.existingInscriptionId
    ? await repriceExistingInscription(validation.existingInscriptionId, { coursePrice, couponFields }, new Date())
    : null;
  const inscription = repriced ?? (await createNewInscription());

  // El cupo se admite en una sola operación atómica sobre el cupón: quien no entra se deshace
  // (la inscripción repreciada ya tomó su lugar antes de actualizarse).
  if (!repriced && hasCoupon && !(await claimSeat(inscription.couponId, inscription._id, new Date()))) {
    await Inscription.deleteOne({ _id: inscription._id });
    throw couponNotValidError('exhausted');
  }

  const inscriptionId = inscription._id.toString();

  // --- Meta CAPI: Lead & InitiateCheckout ---
  // Los flags se persisten con updateOne (NUNCA save() sobre el doc en memoria):
  // evita el VersionError por concurrencia con el save() que persiste mpPreferenceId.
  const fireCapiEvents = async (): Promise<void> => {
    if (!inscription.metaMarketingConsent) return;

    const base = buildInscriptionCapiContext(inscription, coursePrice, courseTitle, inscriptionId, eventSourceUrl);
    const flagsToSet: Record<string, Date> = {};

    const leadPromise = inscription.metaLeadFiredAt
      ? Promise.resolve(null)
      : fireMetaEvent({
        eventName: 'Lead',
        eventId: buildEventId('lead', inscriptionId),
        ...base,
      });

    const checkoutPromise = inscription.metaInitiateCheckoutFiredAt
      ? Promise.resolve(null)
      : fireMetaEvent({
        eventName: 'InitiateCheckout',
        eventId: buildEventId('checkout', inscriptionId),
        ...base,
      });

    const [leadDelivery, checkoutDelivery] = await Promise.all([leadPromise, checkoutPromise]);
    if (leadDelivery?.accepted) flagsToSet.metaLeadFiredAt = new Date();
    if (checkoutDelivery?.accepted) flagsToSet.metaInitiateCheckoutFiredAt = new Date();

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
  // Con cupón nunca se cae al link estático del curso: cobra el precio de lista.
  let activePaymentLink: string | null = hasCoupon ? null : validation.resolvedCourse!.mpPaymentLink || null;

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
          // El descuento solo se puede pagar mientras dura la reserva del cupo.
          ...(hasCoupon ? mercadoPagoExpiration(new Date(), newReservationEnd(inscription.couponReservedAt ?? new Date())) : {}),
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

  if (coursePrice > 0 && !mpInitPoint && !activePaymentLink) {
    logger.warn('[createInscription] Checkout unavailable; retry link provided', { inscriptionId, courseId: inscription.courseId });
  }

  // Enviar email de confirmacion con link de pago.
  // Prioridad: preference dinamica > fallback estatico del curso.
  const sendConfirmationEmail = async () => {
    try {
      const trackedPaymentLink = confirmationPaymentLink({
        coursePrice,
        inscriptionId,
        frontendUrl: getFrontendUrl(),
        isDevelopment: process.env.NODE_ENV !== 'production',
        mpInitPoint,
        sandboxInitPoint,
        activePaymentLink,
      });

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
      logger.info('[createInscription] Confirmation email sent', { inscriptionId });
    } catch (err) {
      logger.error('[createInscription] Error sending confirmation email:', err);
    }
  };

  let emailSettled = false;
  const emailPromise = sendConfirmationEmail().catch((err) => {
    logger.error('[createInscription] Error sending confirmation email:', err);
  }).finally(() => {
    emailSettled = true;
  });

  // Esperamos los side-effects hasta 4s para no degradar la UX. Si SMTP sigue
  // pendiente al responder, el log deja visible que ese correo no está garantizado.
  await Promise.race([
    Promise.allSettled([capiPromise, emailPromise]),
    sleep(4000),
  ]);
  if (!emailSettled) {
    logger.warn('[createInscription] Confirmation email still pending at response cutoff', { inscriptionId });
  }
  logger.info('[createInscription] Checkout response', {
    inscriptionId,
    courseId: inscription.courseId,
    hasDynamicPreference: Boolean(mpInitPoint),
    hasStaticPaymentLink: Boolean(activePaymentLink),
    emailSettled,
  });

  return {
    success: true,
    // Una inscripción repreciada es de otra persona (la que ya existía): no se devuelven sus datos personales.
    data: repriced ? publicInscriptionView(inscription) : inscription,
    mpPaymentLink: activePaymentLink,
    mpInitPoint,
    sandboxInitPoint,
    mpPreferenceId,
  };
};
