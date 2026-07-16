import { sendMetaConversionEvent as sendRaw } from '../meta-capi-service.js';
import { logger } from '../logger.js';

export type MetaEventName = 'PageView' | 'ViewContent' | 'InitiateCheckout' | 'Lead' | 'Purchase';

export interface MetaFireContext {
  eventName: MetaEventName;
  eventId: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  value?: number;
  currency?: string;
  contentName?: string;
  contentIds?: string[];
  contentType?: string;
  fbc?: string;
  fbp?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  eventSourceUrl?: string;
}

export const fireMetaEvent = async (ctx: MetaFireContext): Promise<boolean> => {
  const testEventCode = process.env.META_TEST_EVENT_CODE;

  const ok = await sendRaw({
    eventName: ctx.eventName as any,
    email: ctx.email || '', // legacy fallback
    phone: ctx.phone,
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    value: ctx.value,
    currency: ctx.currency,
    contentName: ctx.contentName,
    contentIds: ctx.contentIds,
    fbc: ctx.fbc,
    fbp: ctx.fbp,
    clientIpAddress: ctx.clientIpAddress,
    clientUserAgent: ctx.clientUserAgent,
    eventSourceUrl: ctx.eventSourceUrl,
    eventId: ctx.eventId,
    testEventCode,
  });

  if (!ok) logger.warn(`[MetaHelper] CAPI ${ctx.eventName} (${ctx.eventId}) no confirmado`);
  return ok;
};

export const buildEventId = (kind: 'pageview' | 'view_content' | 'checkout' | 'lead' | 'purchase', id: string): string =>
  `${kind}_${id}`;
