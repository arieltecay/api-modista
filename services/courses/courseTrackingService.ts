import { fireMetaEvent, buildEventId } from '../meta-capi-helpers/index.js';

export interface CourseViewContext {
  courseId: string;
  courseTitle: string;
  price?: number;
}

export interface TrackingHttpContext {
  clientIpAddress: string;
  clientUserAgent: string;
  eventSourceUrl: string;
  fbc?: string;
  fbp?: string;
  city?: string;
  country?: string;
}

export const trackCourseViewServerSide = (
  ctx: TrackingHttpContext,
  course: CourseViewContext
): void => {
  fireMetaEvent({
    eventName: 'ViewContent',
    eventId: buildEventId('view_content', course.courseId),
    contentName: course.courseTitle,
    contentIds: [course.courseId],
    contentType: 'product',
    value: typeof course.price === 'number' ? course.price : undefined,
    currency: 'ARS',
    fbc: ctx.fbc,
    fbp: ctx.fbp,
    clientIpAddress: ctx.clientIpAddress,
    clientUserAgent: ctx.clientUserAgent,
    city: ctx.city,
    country: ctx.country,
    eventSourceUrl: ctx.eventSourceUrl,
  });
};
