import { sendMetaConversionEvent as sendRaw } from '../meta-capi-service.js';
import { logger } from '../logger.js';
import { hasCurrentMetaMarketingConsent } from '../privacy/marketingConsent.js';
import { META_MARKETING_CONSENT_VERSION } from '../../utils/metaMarketingConsent.js';
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

  if (!result.delivered) {
    logger.warn(`[MetaHelper] CAPI ${ctx.eventName} (${ctx.eventId}) aceptado para retry: ${result.accepted}`);
  }
  return result;
};

export const buildEventId = (
  kind: 'pageview' | 'view_content' | 'checkout' | 'lead' | 'purchase',
  id: string
): string => `${kind}_${id}`;
