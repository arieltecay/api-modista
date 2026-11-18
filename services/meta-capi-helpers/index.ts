import { sendMetaConversionEvent as sendRaw } from '../meta-capi-service.js';
import { logger } from '../logger.js';
import { hasCurrentMetaMarketingConsent } from '../privacy/marketingConsent.js';
import { META_MARKETING_CONSENT_VERSION } from '../../utils/metaMarketingConsent.js';
import { recordCapiDelivery, recordServerConversion } from '../Acquisition/serverEvents.js';
import type { MetaDeliveryResult } from '../meta-capi-service.js';

export type MetaEventName = 'PageView' | 'ViewContent' | 'InitiateCheckout' | 'Lead' | 'Purchase';

export interface MetaFireContext {
  eventName: MetaEventName;
  eventId: string;
  marketingConsent: boolean;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  value?: number;
  currency?: string;
  contentName?: string;
  contentIds?: string[];
  contentType?: string;
  orderId?: string;
  externalId?: string;
  fbc?: string;
  fbp?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  city?: string;
  country?: string;
  eventSourceUrl?: string;
  eventTime?: number;
}

export const fireMetaEvent = async (ctx: MetaFireContext): Promise<MetaDeliveryResult> => {
  if (
    !ctx.marketingConsent ||
    !await hasCurrentMetaMarketingConsent(ctx.externalId, META_MARKETING_CONSENT_VERSION)
  ) return { accepted: false, delivered: false, eventId: ctx.eventId };

  // Acquisition mirror of this consented event; best-effort, it never blocks or fails the send.
  const projection = {
    eventName: ctx.eventName,
    eventId: ctx.eventId,
    occurredAt: ctx.eventTime ? new Date(ctx.eventTime * 1000) : new Date(),
    visitorId: ctx.externalId,
    inscriptionId: ctx.orderId,
    courseId: ctx.contentIds?.[0],
  };
  const conversionRecorded = recordServerConversion(projection); // runs alongside the send; never rejects

  const testEventCode = process.env.META_TEST_EVENT_CODE;

  const result = await sendRaw({
    eventName: ctx.eventName,
    marketingConsent: ctx.marketingConsent,
    email: ctx.email,
    phone: ctx.phone,
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    value: ctx.value,
    currency: ctx.currency,
    contentName: ctx.contentName,
    contentIds: ctx.contentIds,
    contentType: ctx.contentType,
    orderId: ctx.orderId,
    externalId: ctx.externalId,
    fbc: ctx.fbc,
    fbp: ctx.fbp,
    clientIpAddress: ctx.clientIpAddress,
    clientUserAgent: ctx.clientUserAgent,
    city: ctx.city,
    country: ctx.country,
    eventSourceUrl: ctx.eventSourceUrl,
    eventId: ctx.eventId,
    eventTime: ctx.eventTime,
    testEventCode,
  });

  await Promise.all([conversionRecorded, recordCapiDelivery(projection, result)]);

  if (!result.delivered) {
    logger.warn(`[MetaHelper] CAPI ${ctx.eventName} (${ctx.eventId}) aceptado para retry: ${result.accepted}`);
  }
  return result;
};

export const buildEventId = (
  kind: 'pageview' | 'view_content' | 'checkout' | 'lead' | 'purchase',
  id: string
): string => `${kind}_${id}`;
