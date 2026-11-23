import type { Types } from 'mongoose';
import { COUPON_CODE_MAX_LENGTH } from '../../models/Coupon/rules.js';
import { priceWithCoupon } from '../Coupons/index.js';
import { couponRejectionMessage } from '../Coupons/messages.js';
import type { CouponRejection } from '../Coupons/types.js';

/** Coupon columns of an inscription; every one is set here or left empty, never taken from the client. */
export interface InscriptionCouponFields {
  couponId?: Types.ObjectId;
  couponCode?: string;
  listPrice?: number;
  discountAmount?: number;
  couponConfirmedAt?: undefined;
  couponReservedAt?: Date;
}

/**
 * Every coupon column set to empty. Spread first, so a column the client sent in the body can never
 * survive: adding a column to `InscriptionCouponFields` without listing it here fails to compile.
 */
const NO_COUPON_FIELDS: Record<keyof InscriptionCouponFields, undefined> = {
  couponId: undefined,
  couponCode: undefined,
  listPrice: undefined,
  discountAmount: undefined,
  couponConfirmedAt: undefined,
  couponReservedAt: undefined,
};

interface InscriptionPricing {
  /** What MercadoPago charges: the list price, or the one after the coupon. */
  coursePrice: number;
  /** True when a coupon lowered the price; the static course payment link charges the full price. */
  hasCoupon: boolean;
  couponFields: InscriptionCouponFields;
}

export const couponNotValidError = (reason?: CouponRejection): Error & { statusCode: number } =>
  Object.assign(new Error(couponRejectionMessage(reason)), { statusCode: 400 });

/**
 * Prices an inscription with the coupon the client typed. The server decides: a code that does not
 * apply stops the inscription instead of silently charging the full price.
 */
export const priceInscription = async (
  couponCode: unknown,
  course: { courseId: string; price: number },
  now: Date = new Date()
): Promise<InscriptionPricing> => {
  const noCoupon = { coursePrice: course.price, hasCoupon: false, couponFields: NO_COUPON_FIELDS };
  if (couponCode === undefined || couponCode === null) return noCoupon;
  if (typeof couponCode !== 'string' || couponCode.length > COUPON_CODE_MAX_LENGTH) {
    throw couponNotValidError();
  }
  if (couponCode.trim() === '') return noCoupon;

  const pricing = await priceWithCoupon(couponCode, { courseId: course.courseId, price: course.price }, now);
  if (!pricing.valid) throw couponNotValidError(pricing.reason);

  return {
    coursePrice: pricing.finalPrice,
    hasCoupon: true,
    couponFields: {
      ...NO_COUPON_FIELDS,
      couponId: pricing.coupon._id,
      couponCode: pricing.coupon.code,
      listPrice: course.price,
      discountAmount: pricing.discountAmount,
      couponReservedAt: now,
    },
  };
};
