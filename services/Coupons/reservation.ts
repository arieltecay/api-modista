import mongoose from 'mongoose';
import Coupon from '../../models/Coupon/index.js';
import Inscription from '../../models/Inscription.js';
import { evaluateCoupon } from './discount.js';

/** How long an inscription with coupon holds one of the coupon's seats, and how long its MercadoPago preference lives. */
export const COUPON_RESERVATION_MINUTES = 60;
const RESERVATION_MS = COUPON_RESERVATION_MINUTES * 60 * 1000;
/** A payment link cannot be renewed (new reservation) for an inscription older than this. */
const RENEWAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const reservationEnd = (from: Date): Date => new Date(from.getTime() + RESERVATION_MS);
const withOffset = (date: Date): string => date.toISOString().replace('Z', '+00:00');
const asObjectId = (value: unknown): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(String(value));

interface Seat {
  inscriptionId: unknown;
  until?: Date | null;
}

/** Seats of a coupon that are still held at `now`, leaving out the one of `excludeInscriptionId`. */
export const liveSeats = (seats: Seat[] | undefined | null, now: Date, excludeInscriptionId?: unknown): number =>
  (seats ?? []).filter((seat) => seat.until != null && seat.until > now && String(seat.inscriptionId) !== String(excludeInscriptionId ?? '')).length;

/**
 * Admits an inscription into the seats of its coupon in ONE atomic update of the coupon document: expired seats
 * are dropped and the new one is added only if confirmed uses + held seats are below the cap. Because the decision
 * is made by the database on a single document, simultaneous buyers can never get more seats than the cap allows.
 * Asking again for the same inscription renews its seat. Coupons without a cap need no seat.
 */
export const claimSeat = async (couponId: unknown, inscriptionId: unknown, now: Date): Promise<boolean> => {
  const mine = asObjectId(inscriptionId);
  const updated = await Coupon.findOneAndUpdate(
    { _id: couponId, maxUses: { $ne: null } },
    [
      {
        $set: {
          seats: {
            $filter: {
              input: { $ifNull: ['$seats', []] },
              as: 'seat',
              cond: { $and: [{ $gt: ['$$seat.until', now] }, { $ne: ['$$seat.inscriptionId', mine] }] },
            },
          },
        },
      },
      {
        $set: {
          seats: {
            $cond: [
              { $lt: [{ $add: [{ $ifNull: ['$usedCount', 0] }, { $size: '$seats' }] }, '$maxUses'] },
              { $concatArrays: ['$seats', [{ inscriptionId: mine, until: reservationEnd(now) }]] },
              '$seats',
            ],
          },
        },
      },
    ],
    { new: true }
  ).lean();

  if (updated) return updated.seats.some((seat) => String(seat.inscriptionId) === String(mine));
  return Boolean(await Coupon.exists({ _id: couponId, maxUses: null }));
};

export const releaseSeat = async (couponId: unknown, inscriptionId: unknown): Promise<void> => {
  await Coupon.updateOne({ _id: couponId }, { $pull: { seats: { inscriptionId: asObjectId(inscriptionId) } } });
};

/** Expiry for the MercadoPago preference of a coupon inscription: nobody can pay the discount after its seat ends. */
export const mercadoPagoExpiration = (now: Date, until: Date) => ({
  expires: true as const,
  expiration_date_from: withOffset(now),
  expiration_date_to: withOffset(until),
});

/** The end of a reservation that starts now. */
export const newReservationEnd = reservationEnd;

/**
 * Seats for the inscriptions of a coupon that had no cap and gets one: those still inside their 60 minutes
 * (unconfirmed), so the new cap counts them.
 */
export const seedSeats = async (couponId: unknown, now: Date): Promise<Array<{ inscriptionId: unknown; until: Date }>> => {
  const pending = await Inscription.find({ couponId, couponConfirmedAt: null, couponReservedAt: { $gt: new Date(now.getTime() - RESERVATION_MS) } })
    .select('_id couponReservedAt')
    .lean();
  return pending.map((inscription) => ({ inscriptionId: inscription._id, until: reservationEnd(inscription.couponReservedAt as Date) }));
};

interface ReservableInscription {
  _id: unknown;
  courseId: string;
  coursePrice: number;
  couponId?: unknown;
  listPrice?: number | null;
  couponReservedAt?: Date | null;
  fechaInscripcion?: Date | null;
  paymentStatus?: string | null;
}

export type ReservationResult = { ok: true; until: Date } | { ok: false };

/** A seat with less than this left is renewed when the person retries, so the new link can still be paid. */
const RENEW_BELOW_MS = 5 * 60 * 1000;

/**
 * Before creating a new payment preference for an inscription with coupon: the coupon must still apply (a paused or
 * ended coupon stops retries), and its seat (or reservation, for coupons without cap) must be alive, or be renewable
 * because the inscription is recent and there is room. Someone who already paid part keeps the discount they were given.
 */
export const restoreReservation = async (inscription: ReservableInscription, now: Date): Promise<ReservationResult> => {
  if (!inscription.couponId) return { ok: true, until: reservationEnd(now) };
  if (inscription.paymentStatus === 'partial') return { ok: true, until: reservationEnd(now) };

  const coupon = await Coupon.findById(inscription.couponId).lean();
  if (!coupon) return { ok: false };
  const verdict = evaluateCoupon(
    { ...coupon, usedCount: coupon.usedCount + liveSeats(coupon.seats, now, inscription._id) },
    { courseId: inscription.courseId, price: inscription.listPrice ?? inscription.coursePrice, now }
  );
  if (!verdict.valid) return { ok: false };

  const heldSeat = coupon.seats.find((seat) => String(seat.inscriptionId) === String(inscription._id) && seat.until > now);
  if (heldSeat && heldSeat.until.getTime() - now.getTime() >= RENEW_BELOW_MS) return { ok: true, until: heldSeat.until };
  if (!heldSeat && coupon.maxUses == null && inscription.couponReservedAt && reservationEnd(inscription.couponReservedAt) > now) {
    return { ok: true, until: reservationEnd(inscription.couponReservedAt) };
  }

  if (!heldSeat && inscription.fechaInscripcion && now.getTime() - inscription.fechaInscripcion.getTime() > RENEWAL_MAX_AGE_MS) return { ok: false };
  if (!(await claimSeat(coupon._id, inscription._id, now))) return { ok: false };

  await Inscription.updateOne({ _id: inscription._id }, { $set: { couponReservedAt: now } });
  return { ok: true, until: reservationEnd(now) };
};
