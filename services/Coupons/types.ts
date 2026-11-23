export type CouponKind = 'percent' | 'fixed';

/** Why a coupon cannot be applied; the public API never exposes it (anti code-enumeration). */
export type CouponRejection =
  | 'not_found'
  | 'inactive'
  | 'wrong_course'
  | 'not_started'
  | 'expired'
  | 'exhausted'
  | 'not_applicable';

/** What the discount rules need from a coupon. */
export interface CouponRules {
  type: CouponKind;
  value: number;
  startsAt: Date;
  endsAt: Date;
  usedCount: number;
  active: boolean;
  /** Course uuid; null or absent applies to every course. */
  courseId?: string | null;
  /** Null or absent means unlimited. */
  maxUses?: number | null;
}

export interface CouponPurchase {
  courseId: string;
  price: number;
  now: Date;
}

export type CouponEvaluation =
  | { valid: true; discountAmount: number; finalPrice: number }
  | { valid: false; reason: Exclude<CouponRejection, 'not_found'> };

export interface CouponStats {
  /** Inscriptions created with the coupon, paid or not. */
  started: number;
  /** Paid inscriptions. */
  uses: number;
  discountTotal: number;
  netRevenue: number;
  /** Paid uses per local day, `YYYY-MM-DD`, ascending. */
  daily: Array<{ day: string; uses: number }>;
  /** Latest inscriptions with the coupon; the name is abbreviated, never the email. */
  recent: Array<{ name: string; status: 'pending' | 'paid' | 'partial'; date: Date; price: number }>;
}

export interface CouponSummary {
  /** Active coupons inside their window and with uses left. */
  activeCoupons: number;
  uses: number;
  discountTotal: number;
  netRevenue: number;
}

export interface CouponTotals {
  discountTotal: number;
  netRevenue: number;
}

/** A coupon as stored; what the views and the history need. */
export interface StoredCoupon extends CouponRules {
  _id: unknown;
  code: string;
  createdBy?: string | null;
  createdAt?: Date;
}

export interface CouponInput {
  code: string;
  type: CouponKind;
  value: number;
  startsAt: Date;
  endsAt: Date;
  courseId: string | null;
  maxUses: number | null;
  createdBy?: string;
}

/** What an admin may change once a coupon exists. */
export interface CouponUpdate {
  active?: boolean;
  startsAt?: Date;
  endsAt?: Date;
  maxUses?: number | null;
}

export interface CouponListQuery {
  page: number;
  limit: number;
  status?: 'active' | 'paused' | 'scheduled' | 'expired' | 'exhausted';
  courseId?: string;
}

export interface CouponListPage {
  total: number;
  items: Array<{ coupon: StoredCoupon; totals: CouponTotals; courseTitle?: string }>;
}

export interface CouponDetail {
  coupon: StoredCoupon;
  stats: CouponStats;
  courseTitle?: string;
}

export type CouponWriteResult =
  | { ok: true; coupon: StoredCoupon; courseTitle?: string }
  | { ok: false; reason: 'not_found' | 'duplicate' | 'invalid' | 'course_not_found' | 'discount_too_high'; message: string };

export type CouponQuote =
  | { valid: true; code: string; listPrice: number; discountAmount: number; finalPrice: number }
  | { valid: false; reason: CouponRejection };
