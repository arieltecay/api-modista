import mongoose from 'mongoose';
import Coupon from '../../models/Coupon/index.js';
import Course from '../../models/Course.js';
import { COUPON_CODE_INPUT_PATTERN } from '../../models/Coupon/rules.js';
import Inscription from '../../models/Inscription.js';
import { resolveCourseIdentifier } from '../../controllers/courses/helper.js';
import { logger } from '../logger.js';
import { evaluateCoupon } from './discount.js';
import { liveSeats, seedSeats } from './reservation.js';
import { statusFilter } from './status.js';
import type {
  CouponDetail,
  CouponInput,
  CouponListPage,
  CouponListQuery,
  CouponQuote,
  CouponRules,
  CouponRejection,
  CouponStats,
  CouponSummary,
  CouponTotals,
  CouponUpdate,
  CouponWriteResult,
} from './types.js';

const RECENT_LIMIT = 10;
const DAILY_LIMIT = 366;
/** Days of the usage chart are cut at local midnight of this zone (the school works from Tucumán). */
const STATS_TIMEZONE = 'America/Argentina/Tucuman';

const normalizeCode = (code: string): string => code.trim().toUpperCase();

export const findCouponByCode = async (code: string) =>
  COUPON_CODE_INPUT_PATTERN.test(code.trim()) ? Coupon.findOne({ code: normalizeCode(code) }) : null;

type CouponLookup = NonNullable<Awaited<ReturnType<typeof findCouponByCode>>>;
/** The rules of a coupon plus its seats, as stored or as read lean. */
type SeatedCoupon = CouponRules & { seats?: Array<{ inscriptionId: unknown; until?: Date | null }> | null };

type CouponPricing =
  | { valid: true; coupon: CouponLookup; discountAmount: number; finalPrice: number }
  | { valid: false; reason: CouponRejection };

/**
 * The coupon's rules with the seats held by inscriptions still being paid counted as used: otherwise
 * "first 10" could be handed out to anyone.
 */
const rulesWithHeldSeats = (coupon: SeatedCoupon, now: Date) => ({
  type: coupon.type, value: coupon.value, courseId: coupon.courseId, startsAt: coupon.startsAt, endsAt: coupon.endsAt,
  maxUses: coupon.maxUses, active: coupon.active, usedCount: coupon.usedCount + liveSeats(coupon.seats, now),
});

/** Prices a purchase with a coupon code; used both by the public quote and by the inscription. */
export const priceWithCoupon = async (
  code: string,
  purchase: { courseId: string; price: number },
  now: Date = new Date()
): Promise<CouponPricing> => {
  const coupon = await findCouponByCode(code);
  if (!coupon) return { valid: false, reason: 'not_found' };

  const evaluation = evaluateCoupon(rulesWithHeldSeats(coupon, now), { ...purchase, now });
  return evaluation.valid ? { ...evaluation, coupon } : evaluation;
};

/** Coupons that are on, inside their window and under their cap, for one course or for all. */
const activeCandidates = (courseUuid: string, now: Date) =>
  Coupon.find({ $and: [statusFilter('active', now), { $or: [{ courseId: courseUuid }, { courseId: null }] }] }).lean().cursor();

/**
 * Whether the checkout of a course should offer the coupon field: some coupon can be used there right now
 * (on, in its window, with seats left, and not bigger than the price). Reveals no code. It stops at the first
 * usable coupon, so any number of unusable ones in front cannot hide it.
 */
export const hasUsableCoupon = async (courseIdentifier: string, now: Date = new Date()): Promise<boolean> => {
  const course = await resolveCourseIdentifier(courseIdentifier);
  const price = Number(course?.price);
  if (!course?.uuid || !Number.isFinite(price) || price <= 0) return false;

  for await (const coupon of activeCandidates(course.uuid, now)) {
    if (evaluateCoupon(rulesWithHeldSeats(coupon, now), { courseId: course.uuid, price, now }).valid) return true;
  }
  return false;
};

/** The public check of the checkout: the final price a code gives for a course, or just "not valid". */
export const quoteCoupon = async (code: string, courseIdentifier: string): Promise<CouponQuote> => {
  const course = await resolveCourseIdentifier(courseIdentifier);
  const price = Number(course?.price);
  if (!course?.uuid || !Number.isFinite(price) || price <= 0) return { valid: false, reason: 'not_found' };

  const pricing = await priceWithCoupon(code, { courseId: course.uuid, price });
  if (!pricing.valid) return { valid: false, reason: pricing.reason };
  return { valid: true, code: pricing.coupon.code, listPrice: price, discountAmount: pricing.discountAmount, finalPrice: pricing.finalPrice };
};

/**
 * Counts one use of the inscription's coupon, once. The inscription is claimed with an atomic
 * update before the counter moves, so a repeated or concurrent webhook cannot count it twice.
 */
export const confirmCouponUse = async (inscriptionId: string): Promise<boolean> => {
  if (!mongoose.isValidObjectId(inscriptionId)) return false;

  const claimed = await Inscription.findOneAndUpdate(
    { _id: inscriptionId, couponId: { $ne: null }, couponConfirmedAt: null },
    { $set: { couponConfirmedAt: new Date() } },
    { projection: { couponId: 1 } }
  );
  if (!claimed?.couponId) return false;

  try {
    // El lugar reservado de esta inscripción pasa a ser un uso contado (la suma no cambia).
    const updated = await Coupon.findOneAndUpdate(
      { _id: claimed.couponId },
      { $inc: { usedCount: 1 }, $pull: { seats: { inscriptionId: claimed._id } } },
      { new: true }
    ).lean();
    // Un pago aprobado tarde (su lugar venció y otra persona lo tomó) no se puede rechazar: se cuenta y se avisa.
    if (updated && updated.maxUses != null && updated.usedCount > updated.maxUses) {
      logger.warn(`[Coupons] Sobreuso del cupón ${updated.code}: ${updated.usedCount} usos para un tope de ${updated.maxUses} (pago aprobado después de perder el lugar)`);
    }
  } catch (error) {
    // Soltar el candado: si no, el webhook de reintento de MercadoPago ya no podría contar este uso.
    await Inscription.updateOne({ _id: claimed._id }, { $unset: { couponConfirmedAt: 1 } });
    throw error;
  }
  return true;
};

/** Same as `confirmCouponUse` for callers that must never fail because of a coupon (payment flows). */
export const tryConfirmCouponUse = async (inscriptionId: string): Promise<void> => {
  try {
    await confirmCouponUse(inscriptionId);
  } catch (error) {
    logger.error(`[Coupons] No se pudo contar el uso del cupón de ${inscriptionId}`, error);
  }
};

const PAID = { $eq: ['$paymentStatus', 'paid'] };
const ifPaid = (value: unknown) => ({ $cond: [PAID, value, 0] });
/** Discount given and money kept, summed over the paid inscriptions of a group. */
const PAID_TOTALS = {
  discountTotal: { $sum: ifPaid({ $ifNull: ['$discountAmount', 0] }) },
  netRevenue: { $sum: ifPaid('$coursePrice') },
};

export const getCouponStats = async (couponId: string, timezone: string = STATS_TIMEZONE): Promise<CouponStats> => {
  const match = { couponId: new mongoose.Types.ObjectId(couponId) };

  const [facets] = await Inscription.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [{ $group: { _id: null, started: { $sum: 1 }, uses: { $sum: ifPaid(1) }, ...PAID_TOTALS } }],
        daily: [
          { $match: { paymentStatus: 'paid', paymentDate: { $ne: null } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paymentDate', timezone } }, uses: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $limit: DAILY_LIMIT },
        ],
      },
    },
  ]);

  const recent = await Inscription.find(match)
    .sort({ fechaInscripcion: -1, _id: -1 })
    .limit(RECENT_LIMIT)
    .select('nombre apellido paymentStatus fechaInscripcion coursePrice')
    .lean();

  const totals = facets.totals[0] ?? { started: 0, uses: 0, discountTotal: 0, netRevenue: 0 };
  return {
    started: totals.started,
    uses: totals.uses,
    discountTotal: totals.discountTotal,
    netRevenue: totals.netRevenue,
    daily: facets.daily.map((row: { _id: string; uses: number }) => ({ day: row._id, uses: row.uses })),
    recent: recent.map((row) => ({
      name: `${row.nombre} ${row.apellido.trim().charAt(0)}`.trim(),
      status: row.paymentStatus,
      date: row.fechaInscripcion,
      price: row.coursePrice,
    })),
  };
};

export const getCouponSummary = async (now: Date = new Date()): Promise<CouponSummary> => {
  const [activeCoupons, [totals]] = await Promise.all([
    Coupon.countDocuments(statusFilter('active', now)),
    Inscription.aggregate([
      { $match: { couponId: { $ne: null }, paymentStatus: 'paid' } },
      { $group: { _id: null, uses: { $sum: 1 }, ...PAID_TOTALS } },
    ]),
  ]);

  return {
    activeCoupons,
    uses: totals?.uses ?? 0,
    discountTotal: totals?.discountTotal ?? 0,
    netRevenue: totals?.netRevenue ?? 0,
  };
};

/** Discount and revenue of the paid inscriptions of each coupon, for the history table. */
const getTotalsByCoupon = async (couponIds: mongoose.Types.ObjectId[]): Promise<Map<string, CouponTotals>> => {
  const rows: Array<{ _id: mongoose.Types.ObjectId } & CouponTotals> = await Inscription.aggregate([
    { $match: { couponId: { $in: couponIds }, paymentStatus: 'paid' } },
    { $group: { _id: '$couponId', ...PAID_TOTALS } },
  ]);
  return new Map(rows.map((row) => [String(row._id), { discountTotal: row.discountTotal, netRevenue: row.netRevenue }]));
};

const courseTitles = async (uuids: Array<string | null | undefined>): Promise<Map<string, string>> => {
  const wanted = [...new Set(uuids.filter((uuid): uuid is string => Boolean(uuid)))];
  if (wanted.length === 0) return new Map();
  const courses = await Course.find({ uuid: { $in: wanted } }).select('uuid title').lean();
  return new Map(courses.map((course) => [String(course.uuid), course.title]));
};

export const listCoupons = async ({ status, courseId, page, limit }: CouponListQuery, now: Date = new Date()): Promise<CouponListPage> => {
  const filter = { ...(status ? statusFilter(status, now) : {}), ...(courseId ? { courseId } : {}) };

  const [items, total] = await Promise.all([
    Coupon.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Coupon.countDocuments(filter),
  ]);
  const [titles, totals] = await Promise.all([courseTitles(items.map((item) => item.courseId)), getTotalsByCoupon(items.map((item) => item._id))]);

  return {
    total,
    items: items.map((coupon) => ({
      coupon,
      courseTitle: coupon.courseId ? titles.get(coupon.courseId) : undefined,
      totals: totals.get(String(coupon._id)) ?? { discountTotal: 0, netRevenue: 0 },
    })),
  };
};

export const getCouponDetail = async (id: string): Promise<CouponDetail | null> => {
  const coupon = mongoose.isValidObjectId(id) ? await Coupon.findById(id).lean() : null;
  if (!coupon) return null;

  const [titles, stats] = await Promise.all([courseTitles([coupon.courseId]), getCouponStats(id)]);
  return { coupon, stats, courseTitle: coupon.courseId ? titles.get(coupon.courseId) : undefined };
};

const isDuplicateKey = (error: unknown): boolean => (error as { code?: number })?.code === 11000;

/** The model's own (Spanish) message of the first broken rule; never the value that was sent. */
const validationMessage = (error: mongoose.Error.ValidationError): string => Object.values(error.errors)[0]?.message ?? 'Datos inválidos';

export const createCoupon = async (input: CouponInput): Promise<CouponWriteResult> => {
  const course = input.courseId ? await Course.findOne({ uuid: input.courseId }).select('uuid title price').lean() : null;
  if (input.courseId && !course) return { ok: false, reason: 'course_not_found', message: 'El curso seleccionado no existe' };
  if (course && input.type === 'fixed' && input.value >= Number(course.price)) {
    return { ok: false, reason: 'discount_too_high', message: 'El descuento debe ser menor al precio del curso' };
  }

  try {
    const coupon = await Coupon.create(input);
    return { ok: true, coupon, courseTitle: course?.title };
  } catch (error) {
    if (isDuplicateKey(error)) return { ok: false, reason: 'duplicate', message: 'Ya existe un cupón con ese código' };
    if (error instanceof mongoose.Error.ValidationError) return { ok: false, reason: 'invalid', message: validationMessage(error) };
    throw error;
  }
};

export const updateCoupon = async (id: string, changes: CouponUpdate): Promise<CouponWriteResult> => {
  const coupon = mongoose.isValidObjectId(id) ? await Coupon.findById(id) : null;
  if (!coupon) return { ok: false, reason: 'not_found', message: 'No encontrado' };

  const now = new Date();
  if (changes.maxUses != null) {
    // A coupon that had no cap has no seats yet: turn its live reservations into seats before the new cap counts them.
    if (coupon.maxUses == null) coupon.set('seats', await seedSeats(coupon._id, now));
    if (changes.maxUses < coupon.usedCount + liveSeats(coupon.seats, now)) {
      return { ok: false, reason: 'invalid', message: 'El máximo de usos no puede ser menor a los usos ya registrados o reservados' };
    }
  }

  coupon.set(changes);
  try {
    await coupon.save();
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) return { ok: false, reason: 'invalid', message: validationMessage(error) };
    throw error;
  }
  const titles = await courseTitles([coupon.courseId]);
  return { ok: true, coupon, courseTitle: coupon.courseId ? titles.get(coupon.courseId) : undefined };
};
