import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger.js';
import MetaEventDlq from '../models/MetaEventDlq.js';

const PIXEL_ID = process.env.META_PIXEL_ID || '912068635271914';
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
const API_VERSION = 'v21.0';
const API_URL = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;

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
  response?: { data?: unknown; status?: number };
  message?: string;
}

const buildPayload = (event: CapiEventData) => {
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
    access_token: ACCESS_TOKEN ?? '',
  };

  if (event.testEventCode) payload.test_event_code = event.testEventCode;
  return { payload, eventId };
};

const sendOnce = async (
  payload: CapiRequestPayload,
  eventName: CapiEventName
): Promise<{ ok: boolean; error?: string }> => {
  if (!ACCESS_TOKEN) {
    return { ok: false, error: 'META_ACCESS_TOKEN no configurado' };
  }

  try {
    const response = await axios.post<CapiResponsePayload>(API_URL, payload, { timeout: 15_000 });
    return { ok: !!response.data.fbtrace_id };
  } catch (err: unknown) {
    const axiosError = err as CapiErrorResponse;
    const detail = axiosError.response?.data || axiosError.message;
    logger.warn(`[Meta CAPI] Envio directo fallo para '${eventName}': ${JSON.stringify(detail)}`);
    return { ok: false, error: JSON.stringify(detail) };
  }
};

const enqueueDlq = async (event: CapiEventData, eventId: string, errorMessage: string): Promise<void> => {
  try {
    const nextRetryAt = new Date(Date.now() + BASE_BACKOFF_MS);
    await MetaEventDlq.findOneAndUpdate(
      { eventId },
      {
        $set: {
          eventName: event.eventName,
          payload: event as unknown as Record<string, unknown>,
          lastError: errorMessage,
          status: 'pending',
          nextRetryAt,
        },
        $inc: { attempts: 1 },
      },
      { upsert: true, new: true }
    );
    logger.warn(`[Meta CAPI DLQ] Evento '${event.eventName}' (${eventId}) encolado para retry`);
  } catch (dlqError) {
    logger.error('[Meta CAPI DLQ] No se pudo encolar el evento:', dlqError);
  }
};

export const sendMetaConversionEvent = async (event: CapiEventData): Promise<boolean> => {
  const { payload, eventId } = buildPayload(event);
  const result = await sendOnce(payload, event.eventName);

  if (result.ok) {
    logger.info(`[Meta CAPI OK] Evento '${event.eventName}' enviado con exito. EventID: ${eventId}`);
    return true;
  }

  logger.warn(`[Meta CAPI] Fallo envio directo de '${event.eventName}' (${eventId}): ${result.error}`);
  await enqueueDlq(event, eventId, result.error ?? 'unknown');
  return false;
};

export const processDlqBatch = async (limit = 50): Promise<{ sent: number; failed: number }> => {
  if (!ACCESS_TOKEN) {
    logger.warn('[Meta CAPI DLQ] No se puede procesar: ACCESS_TOKEN no configurado');
    return { sent: 0, failed: 0 };
  }

  const now = new Date();
  const pending = await MetaEventDlq.find({
    status: 'pending',
    nextRetryAt: { $lte: now },
    attempts: { $lt: MAX_ATTEMPTS },
  }).limit(limit);

  let sent = 0;
  let failed = 0;

  for (const doc of pending) {
    const event = doc.payload as unknown as CapiEventData;
    const { payload } = buildPayload(event);
    const result = await sendOnce(payload, doc.eventName as CapiEventName);

    if (result.ok) {
      doc.status = 'sent';
      doc.lastError = undefined;
      await doc.save();
      sent++;
      logger.info(`[Meta CAPI DLQ] Reenviado OK: ${doc.eventName} (${doc.eventId})`);
    } else {
      doc.attempts += 1;
      doc.lastError = result.error;
      const backoff = BASE_BACKOFF_MS * Math.pow(2, doc.attempts);
      doc.nextRetryAt = new Date(Date.now() + backoff);
      if (doc.attempts >= MAX_ATTEMPTS) doc.status = 'exhausted';
      await doc.save();
      failed++;
    }
  }

  if (pending.length > 0) {
    logger.info(`[Meta CAPI DLQ] Procesados ${pending.length}: ${sent} OK, ${failed} con error`);
  }
  return { sent, failed };
};
