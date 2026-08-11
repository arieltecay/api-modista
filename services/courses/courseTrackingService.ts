import { fireMetaEvent, buildEventId } from '../meta-capi-helpers/index.js';

export interface CourseViewContext {
  courseId: string;
  courseTitle: string;
  price?: number;
  externalId?: string;
}

export interface TrackingHttpContext {
  clientIpAddress: string;
  clientUserAgent: string;
  eventSourceUrl: string;
  fbc?: string;
  fbp?: string;
  city?: string;
  country?: string;
  sessionId?: string;
}

export const trackCourseViewServerSide = (
  ctx: TrackingHttpContext,
  course: CourseViewContext
): void => {
  // eventId unico por usuario: sessionId permite a Meta deduplicar pixel vs CAPI
  // sin que eventos viejos del DLQ inflen el conteo del server-side
  const sessionSuffix = ctx.sessionId ? `_${ctx.sessionId.slice(0, 8)}` : `_${Date.now()}`;
  const eventId = `${buildEventId('view_content', course.courseId)}${sessionSuffix}`;

  fireMetaEvent({
    eventName: 'ViewContent',
    eventId,
    contentName: course.courseTitle,
    contentIds: [course.courseId],
    contentType: 'product',
    value: typeof course.price === 'number' ? course.price : undefined,
    currency: 'ARS',
    externalId: course.externalId,
    fbc: ctx.fbc,
    fbp: ctx.fbp,
    clientIpAddress: ctx.clientIpAddress,
    clientUserAgent: ctx.clientUserAgent,
    city: ctx.city,
    country: ctx.country,
    eventSourceUrl: ctx.eventSourceUrl,
  });
};
