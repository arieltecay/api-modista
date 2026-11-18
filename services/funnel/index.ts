import { Types } from 'mongoose';
import FunnelEvent from '../../models/FunnelEvent.js';
import Course from '../../models/Course.js';
import { fireMetaEvent, buildEventId } from '../meta-capi-helpers/index.js';

export const FUNNEL_STEPS = [
  'course_detail_view',
  'cta_click',
  'pricing_visible',
  'form_view',
  'form_start',
  'form_submit',
  'lead',
  'initiate_checkout',
  'scroll_50',
  'scroll_90',
  'redirect_to_payment',
  'purchase',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelTrackingInput {
  sessionId: string;
  step: FunnelStep;
  courseId?: string;
  courseTitle?: string;
  inscriptionId?: string;
  value?: number;
  eventId?: string;
  eventTime?: number;
  eventSourceUrl: string;
  utmSource?: string;
  utmCampaign?: string;
  utmMedium?: string;
  referrer?: string;
  fbc?: string;
  fbp?: string;
  device?: 'mobile' | 'desktop';
  clientIpAddress?: string;
  clientUserAgent?: string;
  city?: string;
  country?: string;
  marketingConsent: boolean;
}

const findCourse = async (identifier: string) => {
  const filters: Array<Record<string, unknown>> = [{ uuid: identifier }];
  if (Types.ObjectId.isValid(identifier)) filters.push({ _id: identifier });
  return Course.findOne({ $or: filters }).lean();
};

export const buildLandingViewContentEventId = (courseId: string, sessionId: string): string =>
  `${buildEventId('view_content', courseId)}_${sessionId.slice(0, 8)}`;

const sendLandingViewContent = async (input: FunnelTrackingInput): Promise<void> => {
  if (input.step !== 'course_detail_view' || !input.courseId) return;

  const course = await findCourse(input.courseId);
  if (!course) return;

  const eventId = buildLandingViewContentEventId(input.courseId, input.sessionId);
  if (input.eventId && input.eventId !== eventId) return;

  await fireMetaEvent({
    eventName: 'ViewContent',
    eventId,
    eventTime: input.eventTime,
    marketingConsent: input.marketingConsent,
    contentName: course.title,
    contentIds: [input.courseId],
    contentType: 'product',
    value: course.price,
    currency: 'ARS',
    externalId: input.sessionId,
    fbc: input.fbc,
    fbp: input.fbp,
    clientIpAddress: input.clientIpAddress,
    clientUserAgent: input.clientUserAgent,
    city: input.city,
    country: input.country,
    eventSourceUrl: input.eventSourceUrl,
  });
};

export const recordFunnelEvent = async (input: FunnelTrackingInput): Promise<void> => {
  await Promise.all([
    FunnelEvent.create({
      sessionId: input.sessionId,
      step: input.step,
      courseId: input.courseId,
      courseTitle: input.courseTitle,
      inscriptionId: input.inscriptionId,
      value: input.value,
      utmSource: input.utmSource,
      utmCampaign: input.utmCampaign,
      utmMedium: input.utmMedium,
      referrer: input.referrer,
      device: input.device,
      metaFbc: input.fbc,
      metaFbp: input.fbp,
      clientIpAddress: input.clientIpAddress,
      clientUserAgent: input.clientUserAgent,
    }),
    sendLandingViewContent(input),
  ]);
};
