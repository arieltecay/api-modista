import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger.js';

const PIXEL_ID = process.env.META_PIXEL_ID || '912068635271914';
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
const API_VERSION = 'v21.0';
const API_URL = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

const hashData = (data: string | undefined): string | null => {
  if (!data) return null;
  return crypto
    .createHash('sha256')
    .update(data.trim().toLowerCase())
    .digest('hex');
};

const hashField = (value: string | undefined): string[] | undefined => {
  const hashed = hashData(value);
  return hashed ? [hashed] : undefined;
};

export type CapiEventName = 'PageView' | 'ViewContent' | 'InitiateCheckout' | 'Purchase' | 'Lead';

export interface CapiEventData {
  eventName: CapiEventName;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  value?: number;
  currency?: string;
  contentName?: string;
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
  eventId?: string;
  eventTime?: number;
  contentIds?: string[];
  testEventCode?: string;
}

interface CapiUserData {
  em?: string[] | null;
  ph?: string[] | null;
  fn?: string[] | null;
  ln?: string[] | null;
  ct?: string[] | null;
  country?: string[] | null;
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
  external_id?: string;
}

interface CapiCustomData {
  value?: number;
  currency?: string;
  content_name?: string;
  content_ids?: string[];
  content_type?: string;
  order_id?: string;
}

interface CapiEventPayload {
  event_name: CapiEventName;
  event_time: number;
  action_source: string;
  event_source_url: string;
  user_data: CapiUserData;
  custom_data: CapiCustomData;
  event_id: string;
}

interface CapiRequestPayload {
  data: CapiEventPayload[];
  access_token: string;
  test_event_code?: string;
}

interface CapiResponsePayload {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
}

interface CapiErrorResponse {
  response?: { data?: unknown };
  message?: string;
}

export const sendMetaConversionEvent = async (event: CapiEventData): Promise<boolean> => {
  if (!ACCESS_TOKEN) {
    logger.warn('[Meta CAPI] No se pudo enviar evento: Falta META_ACCESS_TOKEN');
    return false;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const eventTime = event.eventTime && !isNaN(event.eventTime) && event.eventTime > 0
      ? event.eventTime
      : now;

    const userData: CapiUserData = {
      em: hashField(event.email),
      ph: hashField(event.phone),
      fn: hashField(event.firstName),
      ln: hashField(event.lastName),
      ct: hashField(event.city),
      country: hashField(event.country),
      client_ip_address: event.clientIpAddress,
      client_user_agent: event.clientUserAgent,
      fbc: event.fbc,
      fbp: event.fbp,
    };
    if (event.externalId) userData.external_id = event.externalId;

    const eventSourceUrl = event.eventSourceUrl && event.eventSourceUrl.trim().length > 0
      ? event.eventSourceUrl
      : 'https://modista-app.com';

    const customData: CapiCustomData = {
      value: event.value,
      currency: event.currency || 'ARS',
      content_name: event.contentName,
      content_ids: event.contentIds,
      content_type: event.contentType,
      order_id: event.orderId,
    };

    const eventId = event.eventId || event.orderId || `event_${eventTime}_${Math.random().toString(36).slice(2, 11)}`;

    const payload: CapiRequestPayload = {
      data: [
        {
          event_name: event.eventName,
          event_time: eventTime,
          action_source: 'website',
          event_source_url: eventSourceUrl,
          user_data: userData,
          custom_data: customData,
          event_id: eventId,
        },
      ],
      access_token: ACCESS_TOKEN,
    };

    if (event.testEventCode) payload.test_event_code = event.testEventCode;

    const response = await axios.post<CapiResponsePayload>(API_URL, payload, {
      timeout: 5000,
    });

    if (response.data.fbtrace_id) {
      logger.info(`[Meta CAPI OK] Evento '${event.eventName}' enviado con exito. Trace ID: ${response.data.fbtrace_id}`);
      return true;
    }

    return false;
  } catch (error: unknown) {
    const axiosError = error as CapiErrorResponse;
    const errorDetail = axiosError.response?.data || axiosError.message;
    logger.error('[Meta CAPI Error] Fallo al enviar evento a Meta:', {
      eventName: event.eventName,
      detail: errorDetail
    });
    return false;
  }
};
