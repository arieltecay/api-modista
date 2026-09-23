import { Types } from 'mongoose';
import Inscription from '../../models/Inscription.js';
import Turno from '../../models/Turno.js';
import Course from '../../models/Course.js';
import { fireMetaEvent, buildEventId } from '../meta-capi-helpers/index.js';
import { getGeoLocationFromIp } from '../geolocation/index.js';
import { sendWhatsAppTemplate } from '../whatsapp-official-service.js';
import { sendEmail } from '../emailServices.js';
import { logger } from '../logger.js';

interface MPPaymentPayload {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  payment_method_id?: string;
  payer?: { email?: string };
  date_approved?: string;
  date_created?: string;
  external_reference?: string;
  metadata?: { inscription_id?: string; course_title?: string };
}

const RELEVANT_STATUSES = ['approved', 'pending', 'in_process', 'rejected', 'cancelled'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reintenta el envío de un email crítico (el acceso al curso ya pago).
 * 3 intentos con backoff 1s / 3s / 10s. Si todos fallan, queda el error en logs
 * (monitoreable) y la alumna siempre puede reingresar desde /payment/success.
 */
const sendEmailWithRetry = async (options: Parameters<typeof sendEmail>[0], attempts = 3): Promise<boolean> => {
  const backoffs = [1000, 3000, 10000];
  for (let i = 0; i < attempts; i++) {
    try {
      await sendEmail(options);
      return true;
    } catch (err) {
      logger.warn(`[EmailRetry] Intento ${i + 1}/${attempts} falló para ${options.to}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      if (i < attempts - 1) await sleep(backoffs[i]);
    }
  }
  return false;
};

/**
 * Busca el curso asociado a una inscripción por su UUID (curso real).
 * Fallback por título solo para inscripciones legacy.
 */
const findCourseForInscription = async (inscription: any) => {
  const byUuid = await Course.findOne({ uuid: inscription.courseId });
  if (byUuid) return byUuid;
  return Course.findOne({ title: inscription.courseTitle });
};

/**
 * Procesa un pago de MercadoPago (proveniente del webhook o del polling).
 *
 * - Idempotente: si el pago ya está en paymentHistory, no-op.
 * - Solo pagos 'approved' registran monto (rejected/cancelled NUNCA suman:
 *   antes inflaban totalPaid y el Purchase de Meta con value duplicado).
 * - Si status === 'approved' y la inscripción pasa a 'paid' por primera vez,
 *   dispara side-effects (cupo, CAPI Purchase, WhatsApp, email).
 */
export const processWebhookPayment = async (mpPayment: MPPaymentPayload): Promise<void> => {
  const mpPaymentId = mpPayment.id ? String(mpPayment.id) : null;
  const status = mpPayment.status;

  if (!mpPaymentId || !status) {
    logger.warn('[WebhookProcessor] Pago sin id o status', { mpPayment });
    return;
  }

  if (!RELEVANT_STATUSES.includes(status)) {
    logger.info(`[WebhookProcessor] Status ignorado: ${status} para pago ${mpPaymentId}`);
    return;
  }

  // 1. Idempotencia: ¿ya procesamos este mp_payment_id?
  //    Buscamos por el campo notes que contiene "Pago MP #${mpPaymentId}".
  //    NO usamos _id porque Mongoose auto-genera ObjectIds para subdocs
  //    y mpPaymentId de MP es un string numérico (ej: "8472937294") que
  //    causaría BSONError si intentamos convertirlo a ObjectId.
  const dedupPattern = `Pago MP #${mpPaymentId}`;
  const escapedPattern = dedupPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = await Inscription.findOne({
    'paymentHistory.notes': { $regex: escapedPattern, $options: 'i' },
  }).lean();

  if (existing) {
    logger.info(`[WebhookProcessor] Pago ${mpPaymentId} ya procesado (inscripción ${existing._id})`);
    return;
  }

  // 2. Localizar la inscripción por external_reference (= inscriptionId)
  const externalRef = mpPayment.external_reference || mpPayment.metadata?.inscription_id;
  if (!externalRef || !Types.ObjectId.isValid(externalRef)) {
    logger.warn(`[WebhookProcessor] external_reference inválido: ${externalRef}`);
    return;
  }

  const inscription = await Inscription.findById(externalRef);
  if (!inscription) {
    logger.warn(`[WebhookProcessor] Inscripción ${externalRef} no encontrada`);
    return;
  }

  // 3. Solo los pagos APROBADOS se registran en el historial y suman al total.
  //    Rejected/cancelled/pending/in_process solo se loguean: antes sumaban al
  //    totalPaid y duplicaban el value del evento Purchase en Meta.
  if (status !== 'approved') {
    logger.info(`[WebhookProcessor] Pago ${mpPaymentId} con status '${status}' — no suma, solo log`, {
      inscriptionId: inscription._id,
      amount: mpPayment.transaction_amount,
      statusDetail: mpPayment.status_detail,
    });
    return;
  }

  const paymentDate = mpPayment.date_approved ? new Date(mpPayment.date_approved) : new Date();
  const amount = Number(mpPayment.transaction_amount || 0);

  inscription.paymentHistory.push({
    amount,
    date: paymentDate,
    paymentMethod: mpPayment.payment_method_id || 'mercadopago',
    notes: `Pago MP #${mpPaymentId} (${status})`,
  });

  // 4. Recalcular totalPaid y depositAmount (todo paymentHistory es approved)
  const totalPaid = inscription.paymentHistory.reduce((sum, p) => sum + (p.amount || 0), 0);
  inscription.depositAmount = totalPaid;
  inscription.depositDate = paymentDate;

  // 5. Actualizar paymentStatus
  const wasAlreadyPaid = inscription.paymentStatus === 'paid';

  inscription.paymentStatus = totalPaid >= inscription.coursePrice ? 'paid' : 'partial';
  inscription.paymentDate = inscription.paymentStatus === 'paid' ? paymentDate : inscription.paymentDate;
  inscription.paymentSource = 'webhook';

  // 6. Reservar cupo (solo si pasa a 'paid' y no estaba reservado)
  if (inscription.paymentStatus === 'paid' && !inscription.isReserved && inscription.turnoId) {
    const turno = await Turno.findById(inscription.turnoId);
    if (turno && turno.cuposInscriptos < turno.cupoMaximo) {
      await Turno.findByIdAndUpdate(inscription.turnoId, { $inc: { cuposInscriptos: 1 } });
      inscription.isReserved = true;
    } else {
      logger.warn(`[WebhookProcessor] Turno ${inscription.turnoId} lleno o no encontrado, no se reservó cupo`);
    }
  }

  await inscription.save();

  // 7. Side-effects solo en transición a 'paid' (no en webhook duplicado ni en pagos extra)
  if (inscription.paymentStatus === 'paid' && !wasAlreadyPaid) {
    await firePaymentApprovedSideEffects(inscription, totalPaid);
  }
};

const firePaymentApprovedSideEffects = async (
  inscription: any,
  totalPaid: number
): Promise<void> => {
  const inscriptionId = inscription._id.toString();

  // Evitar re-envío si el Purchase ya fue disparado (por redirect de MP o admin manual)
  if (inscription.metaPurchaseFiredAt) {
    logger.info(`[WebhookProcessor] Purchase CAPI ya fue enviado para ${inscriptionId}, omitiendo.`);
    return;
  }

  await sendPurchaseCapiEvent(inscription, totalPaid, inscriptionId);

  // Curso asociado una sola vez (por uuid; fallback título legacy)
  const coursePaidLink = await resolveCoursePaidLink(inscription);

  await sendWhatsAppAccessMessage(inscription, coursePaidLink, inscriptionId);
  await sendCourseAccessEmail(inscription, coursePaidLink, inscriptionId);
};

/** Meta CAPI: evento Purchase (con flags para idempotencia post-save). */
const sendPurchaseCapiEvent = async (
  inscription: any,
  totalPaid: number,
  inscriptionId: string
): Promise<void> => {
  try {
    const geo = getGeoLocationFromIp(inscription.clientIpAddress || '');
    const ok = await fireMetaEvent({
      eventName: 'Purchase',
      eventId: buildEventId('purchase', inscriptionId),
      email: inscription.email,
      phone: inscription.celular,
      firstName: inscription.nombre,
      lastName: inscription.apellido,
      value: totalPaid,
      currency: 'ARS',
      contentName: inscription.courseTitle,
      contentIds: [inscription.courseId],
      contentType: 'product',
      externalId: inscriptionId,
      fbc: inscription.metaFbc,
      fbp: inscription.metaFbp,
      clientIpAddress: inscription.clientIpAddress,
      clientUserAgent: inscription.clientUserAgent,
      city: geo.city,
      country: geo.country,
      eventSourceUrl: inscription.eventSourceUrl || 'https://modista-app.com/payment/success',
    });
    if (ok) {
      inscription.metaPurchaseFiredAt = new Date();
      await inscription.save();
    } else {
      logger.warn(`[WebhookProcessor] CAPI Purchase no confirmado para ${inscriptionId}`);
    }
  } catch (err) {
    logger.error('[WebhookProcessor] Error en CAPI Purchase', err);
  }
};

/** Resuelve el link de acceso al contenido del curso (coursePaid del curso). */
const resolveCoursePaidLink = async (inscription: any): Promise<string> => {
  const course = await findCourseForInscription(inscription);
  return course?.coursePaid || 'https://modista-app.com/cursos';
};

/** WhatsApp con el acceso al curso (await: serverless-safe). */
const sendWhatsAppAccessMessage = async (
  inscription: any,
  coursePaidLink: string,
  inscriptionId: string
): Promise<void> => {
  if (!inscription.celular) return;
  try {
    const components = [
      {
        type: 'body',
        parameters: [
          { type: 'text', parameter_name: 'nombre_alumno', text: `${inscription.nombre} ${inscription.apellido}` },
          { type: 'text', parameter_name: 'nombre_curso', text: inscription.courseTitle },
          { type: 'text', parameter_name: 'enlace_acceso', text: coursePaidLink },
        ],
      },
    ];

    const whatsappOk = await sendWhatsAppTemplate(inscription.celular, 'inscripcion_pago_utilidad', components, 'es_AR');
    if (!whatsappOk) {
      logger.warn(`[WebhookProcessor] WhatsApp template no enviado para ${inscriptionId}`);
    }
  } catch (err) {
    logger.error('[WebhookProcessor] Error enviando WhatsApp', err);
  }
};

/** Email unificado: confirmación de pago + link de acceso (con retry). */
const sendCourseAccessEmail = async (
  inscription: any,
  coursePaidLink: string,
  inscriptionId: string
): Promise<void> => {
  const emailSent = await sendEmailWithRetry({
    to: inscription.email,
    subject: `¡Pago confirmado! Accedé a "${inscription.courseTitle}"`,
    templateName: 'paymentCourseAccess',
    data: {
      name: `${inscription.nombre} ${inscription.apellido}`,
      courseTitle: inscription.courseTitle,
      coursePaid: coursePaidLink,
      year: new Date().getFullYear().toString(),
    },
  });

  if (!emailSent) {
    logger.error(`[WebhookProcessor] Email de acceso NO enviado tras reintentos para ${inscriptionId}`);
  }
};
