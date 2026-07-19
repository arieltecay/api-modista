import { Types } from 'mongoose';
import Inscription from '../../models/Inscription.js';
import Turno from '../../models/Turno.js';
import Course from '../../models/Course.js';
import { sendMetaConversionEvent } from '../meta-capi-service.js';
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

/**
 * Procesa un pago de MercadoPago (proveniente del webhook o del polling).
 *
 * - Idempotente: si el pago ya está en paymentHistory, no-op.
 * - Si status === 'approved' y la inscripción pasa a 'paid' por primera vez,
 *   dispara side-effects (cupo, CAPI Purchase, WhatsApp, email).
 * - Si status ya estaba en 'paid' y vuelve a llegar un 'approved' (webhook duplicado
 *   o pago extra), solo agrega al paymentHistory sin re-disparar side-effects.
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

  // 3. Registrar el pago en el historial
  //    Mongoose auto-genera el _id del subdocumento, no lo forzamos.
  const paymentDate = mpPayment.date_approved ? new Date(mpPayment.date_approved) : new Date();
  const amount = Number(mpPayment.transaction_amount || 0);

  inscription.paymentHistory.push({
    amount,
    date: paymentDate,
    paymentMethod: mpPayment.payment_method_id || 'mercadopago',
    notes: `Pago MP #${mpPaymentId} (${status})`,
  });

  // 4. Recalcular totalPaid y depositAmount
  const totalPaid = inscription.paymentHistory.reduce((sum, p) => sum + (p.amount || 0), 0);
  inscription.depositAmount = totalPaid;
  inscription.depositDate = paymentDate;

  // 5. Actualizar paymentStatus según corresponda
  const wasAlreadyPaid = inscription.paymentStatus === 'paid';

  if (status === 'approved') {
    inscription.paymentStatus = totalPaid >= inscription.coursePrice ? 'paid' : 'partial';
    inscription.paymentDate = inscription.paymentStatus === 'paid' ? paymentDate : inscription.paymentDate;
    inscription.paymentSource = 'webhook';
  } else if (status === 'rejected' || status === 'cancelled') {
    logger.info(`[WebhookProcessor] Pago ${mpPaymentId} ${status} para inscripción ${inscription._id}`);
  }

  // 6. Reservar cupo (solo si pasa a 'paid' y no estaba reservado)
  if (status === 'approved' && inscription.paymentStatus === 'paid' && !inscription.isReserved && inscription.turnoId) {
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
  if (status === 'approved' && inscription.paymentStatus === 'paid' && !wasAlreadyPaid) {
    await firePaymentApprovedSideEffects(inscription, totalPaid);
  }
};

const firePaymentApprovedSideEffects = async (
  inscription: any,
  totalPaid: number
): Promise<void> => {
  const inscriptionId = inscription._id.toString();

  // Meta CAPI: Purchase
  try {
    const ok = await sendMetaConversionEvent({
      eventName: 'Purchase',
      email: inscription.email,
      phone: inscription.celular,
      firstName: inscription.nombre,
      lastName: inscription.apellido,
      value: totalPaid,
      contentName: inscription.courseTitle,
      orderId: `purchase_${inscriptionId}`,
      fbc: inscription.metaFbc,
      fbp: inscription.metaFbp,
      clientIpAddress: inscription.clientIpAddress,
      clientUserAgent: inscription.clientUserAgent,
    });
    if (!ok) {
      logger.warn(`[WebhookProcessor] CAPI Purchase no confirmado para ${inscriptionId}`);
    }
  } catch (err) {
    logger.error('[WebhookProcessor] Error en CAPI Purchase', err);
  }

  // WhatsApp template
  if (inscription.celular) {
    try {
      const course = await Course.findOne({ title: inscription.courseTitle });
      const courseLink = course?.coursePaid || 'https://modista-app.com/cursos';

      const components = [
        {
          type: 'body',
          parameters: [
            { type: 'text', parameter_name: 'nombre_alumno', text: `${inscription.nombre} ${inscription.apellido}` },
            { type: 'text', parameter_name: 'nombre_curso', text: inscription.courseTitle },
            { type: 'text', parameter_name: 'enlace_acceso', text: courseLink },
          ],
        },
      ];

      sendWhatsAppTemplate(inscription.celular, 'inscripcion_pago_utilidad', components, 'es_AR')
        .then((ok) => {
          if (!ok) {
            logger.warn(`[WebhookProcessor] WhatsApp template no enviado para ${inscriptionId}`);
          }
        })
        .catch((err) => logger.error('[WebhookProcessor] Error en WhatsApp', err));
    } catch (err) {
      logger.error('[WebhookProcessor] Error preparando WhatsApp', err);
    }
  }

  // Email unificado: confirmacion de pago + link de acceso al curso
  try {
    const course = await Course.findOne({ title: inscription.courseTitle });
    const coursePaidLink = course?.coursePaid || 'https://modista-app.com/cursos';

    await sendEmail({
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
  } catch (err) {
    logger.error('[WebhookProcessor] Error enviando email unificado post-pago', err);
  }
};
