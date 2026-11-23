import Inscription from '../../models/Inscription.js';
import { COUPON_RESERVATION_MINUTES, claimSeat, releaseSeat } from '../Coupons/reservation.js';
import { couponNotValidError, type InscriptionCouponFields } from './couponPricing.js';

const RESERVATION_MS = COUPON_RESERVATION_MINUTES * 60 * 1000;

interface ExistingInscription {
  paymentStatus?: string | null;
  depositAmount?: number | null;
  paymentHistory?: unknown[] | null;
  couponReservedAt?: Date | null;
}

/**
 * An unpaid inscription can take a (new) coupon instead of answering "already enrolled": nothing was paid,
 * a coupon code was typed, and it does not hold a live coupon reservation. The code is the authorization:
 * an admin hands out a new one to whoever asks again after their payment fell.
 */
export const canRepriceWithCoupon = (existing: ExistingInscription, couponCode: unknown, now: Date): boolean =>
  typeof couponCode === 'string' &&
  couponCode.trim() !== '' &&
  existing.paymentStatus === 'pending' &&
  (existing.paymentHistory?.length ?? 0) === 0 &&
  !((existing.depositAmount ?? 0) > 0) &&
  !(existing.couponReservedAt && now.getTime() - existing.couponReservedAt.getTime() < RESERVATION_MS);

/** The seat is taken first (atomic); the inscription keeps its id and its stored personal data, only the price changes. */
export const repriceExistingInscription = async (
  inscriptionId: unknown,
  pricing: { coursePrice: number; couponFields: InscriptionCouponFields },
  now: Date
) => {
  const { couponId, couponCode, listPrice, discountAmount } = pricing.couponFields;
  if (!(await claimSeat(couponId, inscriptionId, now))) throw couponNotValidError('exhausted');

  const updated = await Inscription.findOneAndUpdate(
    { _id: inscriptionId, paymentStatus: 'pending' },
    { $set: { coursePrice: pricing.coursePrice, couponId, couponCode, listPrice, discountAmount, couponReservedAt: now }, $unset: { couponConfirmedAt: 1 } },
    { new: true }
  );
  if (!updated) {
    await releaseSeat(couponId, inscriptionId);
    throw Object.assign(new Error('Ya te encuentras inscripto en este curso con este email.'), { statusCode: 409 });
  }
  return updated;
};

/** What a repriced inscription may show to whoever asked: never the personal data stored in it. */
export const publicInscriptionView = (inscription: { _id: unknown; courseId: string; courseTitle: string; coursePrice: number; paymentStatus?: string }) => ({
  _id: inscription._id,
  courseId: inscription.courseId,
  courseTitle: inscription.courseTitle,
  coursePrice: inscription.coursePrice,
  paymentStatus: inscription.paymentStatus,
});
