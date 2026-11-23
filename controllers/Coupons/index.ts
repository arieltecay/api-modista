import type { Request, Response } from 'express';
import type { ZodError } from 'zod';
import {
  createCoupon,
  getCouponDetail,
  getCouponSummary,
  listCoupons,
  quoteCoupon,
  updateCoupon,
} from '../../services/Coupons/index.js';
import { couponRejectionMessage } from '../../services/Coupons/messages.js';
import { couponStatus } from '../../services/Coupons/status.js';
import type { CouponTotals, StoredCoupon } from '../../services/Coupons/types.js';
import { createBody, listQuery, updateBody, validateBody } from './schemas.js';

const WRITE_FAILURE_STATUS = { not_found: 404, duplicate: 409, invalid: 400, course_not_found: 400, discount_too_high: 400 } as const;

/** Names the offending fields only; the input itself is never echoed back. */
const invalidMessage = (error: ZodError): string => {
  const issue = error.issues[0];
  if (issue.code === 'custom') return issue.message;
  return `Datos inválidos: ${issue.path.join('.') || 'cuerpo'}`;
};

const toView = (coupon: StoredCoupon, courseTitle: string | undefined, totals?: CouponTotals) => ({
  id: String(coupon._id),
  code: coupon.code,
  type: coupon.type,
  value: coupon.value,
  courseId: coupon.courseId ?? null,
  courseTitle,
  startsAt: coupon.startsAt,
  endsAt: coupon.endsAt,
  maxUses: coupon.maxUses ?? null,
  usedCount: coupon.usedCount,
  active: coupon.active,
  status: couponStatus(coupon, new Date()),
  createdBy: coupon.createdBy,
  createdAt: coupon.createdAt,
  ...totals,
});

const sendInvalid = (res: Response, error: ZodError): void => {
  res.status(400).json({ success: false, message: invalidMessage(error) });
};

export const couponsController = {
  /** Public: the final price a code gives for a course. Every failure reads the same, so codes cannot be probed. */
  validateCoupon: async (req: Request, res: Response): Promise<void> => {
    const parsed = validateBody.safeParse(req.body);
    if (!parsed.success) return sendInvalid(res, parsed.error);

    const quote = await quoteCoupon(parsed.data.code, parsed.data.courseId);
    res.locals.couponValid = quote.valid; // lo lee el limitador: un cupón válido no gasta intentos
    res.status(200).json(quote.valid ? quote : { valid: false, message: couponRejectionMessage(quote.reason) });
  },

  getSummary: async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(await getCouponSummary());
  },

  listCoupons: async (req: Request, res: Response): Promise<void> => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return sendInvalid(res, parsed.error);

    const { items, total } = await listCoupons(parsed.data);
    res.status(200).json({
      items: items.map(({ coupon, courseTitle, totals }) => toView(coupon, courseTitle, totals)),
      page: parsed.data.page,
      limit: parsed.data.limit,
      total,
    });
  },

  getCoupon: async (req: Request, res: Response): Promise<void> => {
    const detail = await getCouponDetail(String(req.params.id));
    if (!detail) {
      res.status(404).json({ success: false, message: 'No encontrado' });
      return;
    }
    res.status(200).json({ ...toView(detail.coupon, detail.courseTitle), stats: detail.stats });
  },

  createCoupon: async (req: Request, res: Response): Promise<void> => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return sendInvalid(res, parsed.error);

    const result = await createCoupon({ ...parsed.data, createdBy: req.user?.email });
    if (!result.ok) {
      res.status(WRITE_FAILURE_STATUS[result.reason]).json({ success: false, message: result.message });
      return;
    }
    res.status(201).json(toView(result.coupon, result.courseTitle));
  },

  updateCoupon: async (req: Request, res: Response): Promise<void> => {
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return sendInvalid(res, parsed.error);

    const result = await updateCoupon(String(req.params.id), parsed.data);
    if (!result.ok) {
      res.status(WRITE_FAILURE_STATUS[result.reason]).json({ success: false, message: result.message });
      return;
    }
    res.status(200).json(toView(result.coupon, result.courseTitle));
  },
};
