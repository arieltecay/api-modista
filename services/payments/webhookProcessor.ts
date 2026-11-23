import { Types } from 'mongoose';
import Inscription from '../../models/Inscription.js';
import Turno from '../../models/Turno.js';
import Course from '../../models/Course.js';
import { fireMetaEvent, buildEventId } from '../meta-capi-helpers/index.js';
import { getGeoLocationFromIp } from '../geolocation/index.js';
import { sendWhatsAppTemplate } from '../whatsapp-official-service.js';
import { sendEmail, isEmailDeliverySimulated } from '../emailServices.js';
import { escapeHtml } from '../fsTemplate.js';
import { issueInvoiceForPayment } from '../invoicing/index.js';
import { invoiceEmailBlock } from '../invoicing/emailBlock.js';
import { markInvoiceEmailed } from '../invoicing/notify.js';
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
const isPaymentAccessWhatsAppEnabled = (): boolean => process.env.PAYMENT_ACCESS_WHATSAPP_ENABLED !== 'false';

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
export const processWebhookPayment = async (
  mpPayment: MPPaymentPayload,
  hooks: PaymentHooks = defaultHooks
): Promise<void> => {
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
  const whatsappEnabled = isPaymentAccessWhatsAppEnabled();

  inscription.paymentStatus = totalPaid >= inscription.coursePrice ? 'paid' : 'partial';
  if (inscription.paymentStatus === 'paid' && !wasAlreadyPaid) {
    inscription.accessWhatsAppStatus = whatsappEnabled ? 'pending' : 'disabled';
    inscription.accessEmailStatus = 'pending';
  }
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
    await firePaymentApprovedSideEffects(inscription, totalPaid, paymentDate, mpPaymentId, whatsappEnabled, hooks);
  }
};

const firePaymentApprovedSideEffects = async (
  inscription: any,
  totalPaid: number,
  paymentDate: Date,
  mpPaymentId: string,
  whatsappEnabled: boolean,
  hooks: PaymentHooks,
): Promise<void> => {
  const inscriptionId = inscription._id.toString();

  // Evitar re-envío del Purchase si ya fue disparado (por redirect de MP o admin manual).
  // Esto NO debe saltear el resto: la factura, el WhatsApp y el email de acceso salen igual.
  if (inscription.metaPurchaseFiredAt) {
    logger.info(`[WebhookProcessor] Purchase CAPI ya fue enviado para ${inscriptionId}, omitiendo.`);
  } else {
    try {
      await hooks.sendPurchaseEvent(inscription, totalPaid, inscriptionId, paymentDate);
    } catch (error) {
      logger.error('[WebhookProcessor] Error enviando Purchase CAPI', error);
    }
  }

  // La factura se emite con el pago ya verificado y guardado; si ARCA no responde a tiempo el mail sale sin ella.
  const invoiceUrl = await resolveInvoiceUrl(inscription, totalPaid, mpPaymentId, hooks);

  // Curso asociado una sola vez (por uuid; fallback título legacy)
  let coursePaidLink: string;
  try {
    coursePaidLink = await resolveCoursePaidLink(inscription);
  } catch (error) {
    logger.error('[WebhookProcessor] Error buscando el enlace del curso', error);
    if (whatsappEnabled) await recordAccessStatus(inscriptionId, 'accessWhatsAppStatus', false);
    await recordAccessStatus(inscriptionId, 'accessEmailStatus', false);
    return;
  }

  if (whatsappEnabled) {
    try {
      const accepted = await hooks.sendWhatsApp(inscription, coursePaidLink, inscriptionId);
      await recordAccessStatus(inscriptionId, 'accessWhatsAppStatus', accepted);
    } catch (error) {
      logger.error('[WebhookProcessor] Error enviando WhatsApp', error);
      await recordAccessStatus(inscriptionId, 'accessWhatsAppStatus', false);
    }
  }
  try {
    const accepted = await hooks.sendAccessEmail(inscription, coursePaidLink, inscriptionId, invoiceUrl);
    await recordAccessStatus(inscriptionId, 'accessEmailStatus', accepted);
  } catch (error) {
    logger.error('[WebhookProcessor] Error enviando el correo de acceso', error);
    await recordAccessStatus(inscriptionId, 'accessEmailStatus', false);
  }
};

const recordAccessStatus = async (inscriptionId: string, channel: 'accessEmailStatus' | 'accessWhatsAppStatus', accepted: boolean | null): Promise<void> => {
  try {
    await Inscription.updateOne({ _id: inscriptionId }, { $set: { [channel]: accepted === null ? 'unknown' : accepted ? 'accepted' : 'failed' } });
  } catch (error) {
    logger.error(`[WebhookProcessor] No se pudo registrar ${channel} para ${inscriptionId}`, error);
  }
};

/** Link a la factura autorizada, o undefined. Un fallo de facturación nunca debe frenar el mail de acceso. */
const resolveInvoiceUrl = async (
  inscription: any,
  totalPaid: number,
  mpPaymentId: string,
  hooks: PaymentHooks,
): Promise<string | undefined> => {
  try {
    const link = await hooks.issueInvoice({
      inscriptionId: inscription._id.toString(),
      total: totalPaid,
      courseTitle: inscription.courseTitle,
      name: `${inscription.nombre} ${inscription.apellido}`,
      email: inscription.email,
      mpPaymentId,
    });
    return link?.url;
  } catch (err) {
    logger.error('[WebhookProcessor] Error emitiendo la factura', err);
    return undefined;
  }
};

/** Meta CAPI: evento Purchase (con flags para idempotencia post-save). */
const sendPurchaseCapiEvent = async (
  inscription: any,
  totalPaid: number,
  inscriptionId: string,
  paymentDate: Date,
): Promise<void> => {
  try {
    const geo = getGeoLocationFromIp(inscription.clientIpAddress || '');
    const delivery = await fireMetaEvent({
      eventName: 'Purchase',
      marketingConsent: inscription.metaMarketingConsent === true,
      eventId: buildEventId('purchase', inscriptionId),
      eventTime: Math.floor(paymentDate.getTime() / 1000),
      orderId: inscriptionId,
      email: inscription.email,
      phone: inscription.celular,
      firstName: inscription.nombre,
      lastName: inscription.apellido,
      value: totalPaid,
      currency: 'ARS',
      contentName: inscription.courseTitle,
      contentIds: [inscription.courseId],
      contentType: 'product',
      externalId: inscription.sessionId,
      fbc: inscription.metaFbc,
      fbp: inscription.metaFbp,
      clientIpAddress: inscription.clientIpAddress,
      clientUserAgent: inscription.clientUserAgent,
      city: geo.city,
      country: geo.country,
      eventSourceUrl: 'https://modista-app.com/payment/success',
    });
    if (delivery.accepted) {
      inscription.metaPurchaseFiredAt = new Date();
      await inscription.save();
    } else {
      logger.warn(`[WebhookProcessor] CAPI Purchase no persistido para ${inscriptionId}`);
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
): Promise<boolean> => {
  if (!inscription.celular) return false;
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
    return whatsappOk;
  } catch (err) {
    logger.error('[WebhookProcessor] Error enviando WhatsApp', err);
    return false;
  }
};

/** Email unificado: confirmación de pago + link de acceso (con retry). */
/** Datos de la plantilla de acceso: lo que escribió la persona en el formulario va escapado. */
export const buildAccessEmailData = (
  inscription: { nombre: string; apellido: string; courseTitle: string },
  coursePaidLink: string,
  invoiceUrl?: string
): Record<'name' | 'courseTitle' | 'coursePaid' | 'invoiceBlock' | 'year', string> => ({
  name: escapeHtml(`${inscription.nombre} ${inscription.apellido}`),
  courseTitle: escapeHtml(inscription.courseTitle),
  coursePaid: escapeHtml(coursePaidLink),
  invoiceBlock: invoiceUrl ? invoiceEmailBlock(invoiceUrl) : '',
  year: new Date().getFullYear().toString(),
});

const sendCourseAccessEmail = async (
  inscription: any,
  coursePaidLink: string,
  inscriptionId: string,
  invoiceUrl?: string
): Promise<boolean | null> => {
  const emailSent = await sendEmailWithRetry({
    to: inscription.email,
    subject: `¡Pago confirmado! Accedé a "${inscription.courseTitle}"`,
    templateName: 'paymentCourseAccess',
    data: buildAccessEmailData(inscription, coursePaidLink, invoiceUrl),
  });

  if (!emailSent) {
    logger.error(`[WebhookProcessor] Email de acceso NO enviado tras reintentos para ${inscriptionId}`);
  } else if (invoiceUrl) {
    // El mail ya llevó el link: el reintento no debe mandarlo de nuevo.
    try {
      await markInvoiceEmailed(inscriptionId);
    } catch (error) {
      logger.error('[WebhookProcessor] No se pudo registrar el envío de la factura', error);
    }
  }
  return emailSent && isEmailDeliverySimulated() ? null : emailSent;
};

/** Efectos del pago aprobado; inyectables para probar el orden y las fallas sin servicios externos. */
export interface PaymentHooks {
  sendPurchaseEvent: typeof sendPurchaseCapiEvent;
  issueInvoice: typeof issueInvoiceForPayment;
  sendWhatsApp: typeof sendWhatsAppAccessMessage;
  sendAccessEmail: typeof sendCourseAccessEmail;
}

const defaultHooks: PaymentHooks = {
  sendPurchaseEvent: sendPurchaseCapiEvent,
  issueInvoice: issueInvoiceForPayment,
  sendWhatsApp: sendWhatsAppAccessMessage,
  sendAccessEmail: sendCourseAccessEmail,
};
