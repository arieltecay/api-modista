import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger.js';
import MetaEventDlq from '../models/MetaEventDlq.js';
import { normalizeClientIpAddress } from '../utils/clientIpAddress.js';
import { hasCurrentMetaMarketingConsent } from './privacy/marketingConsent.js';
import { META_MARKETING_CONSENT_VERSION } from '../utils/metaMarketingConsent.js';

// Lectura LAZY de env vars: en ESM los módulos pueden evaluarse antes de que
// dotenv.config() cargue el .env, así que leer process.env a nivel de módulo es
// frágil. Getters garantizan el valor correcto en el momento de cada llamada.
const getPixelId = (): string | undefined => process.env.META_PIXEL_ID;
const getAccessToken = (): string | undefined =>
  process.env.META_CAPI_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
const API_VERSION = 'v21.0';
const buildApiUrl = (pixelId: string) => `https://graph.facebook.com/${API_VERSION}/${pixelId}/events`;

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;
const DIRECT_SEND_TIMEOUT_MS = 2_500;
const INITIAL_OUTBOX_LEASE_MS = DIRECT_SEND_TIMEOUT_MS + 5_000;

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
  marketingConsent?: boolean;
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

export interface MetaDeliveryResult {
  accepted: boolean;
  delivered: boolean;
  eventId: string;
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
    client_ip_address: normalizeClientIpAddress(event.clientIpAddress),
    client_user_agent: event.clientUserAgent,
    fbc: event.fbc,
    fbp: event.fbp,
  };
  if (event.externalId) userData.external_id = hashData(event.externalId) ?? undefined;

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
    access_token: getAccessToken() ?? '',
  };

  if (event.testEventCode) payload.test_event_code = event.testEventCode;
  return { payload, eventId };
};

const sendOnce = async (
  payload: CapiRequestPayload,
  eventName: CapiEventName
): Promise<{ ok: boolean; error?: string }> => {
  const accessToken = getAccessToken();
  const pixelId = getPixelId();

  if (!accessToken) {
    return { ok: false, error: 'META_ACCESS_TOKEN no configurado' };
  }
  if (!pixelId) {
    return { ok: false, error: 'META_PIXEL_ID no configurado' };
  }

  try {
    const requestPayload: CapiRequestPayload = { ...payload, access_token: accessToken };
    const response = await axios.post<CapiResponsePayload>(buildApiUrl(pixelId), requestPayload, {
      timeout: DIRECT_SEND_TIMEOUT_MS,
    });
    return { ok: !!response.data.fbtrace_id };
  } catch (err: unknown) {
    const axiosError = err as CapiErrorResponse;
    const detail = axiosError.response?.data || axiosError.message;
    logger.warn(`[Meta CAPI] Envio directo fallo para '${eventName}': ${JSON.stringify(detail)}`);
    return { ok: false, error: JSON.stringify(detail) };
  }
};

const persistPendingEvent = async (
  event: CapiEventData,
  eventId: string,
): Promise<{ persisted: boolean; alreadyDelivered: boolean; claimed: boolean }> => {
  const directSendClaim = crypto.randomUUID();
  try {
    const stored = await MetaEventDlq.findOneAndUpdate(
      { eventId, outboxVersion: 2 },
      {
        $setOnInsert: {
          eventName: event.eventName,
          outboxVersion: 2,
          payload: event as unknown as Record<string, unknown>,
          status: 'pending',
          attempts: 0,
          nextRetryAt: new Date(Date.now() + INITIAL_OUTBOX_LEASE_MS),
          directSendClaim,
        },
      },
      { upsert: true, new: true }
    );
    return {
      persisted: true,
      alreadyDelivered: stored?.status === 'sent',
      claimed: stored?.directSendClaim === directSendClaim,
    };
  } catch (dlqError) {
    logger.error('[Meta CAPI Outbox] No se pudo persistir el evento:', dlqError);
    return { persisted: false, alreadyDelivered: false, claimed: false };
  }
};

export const sendMetaConversionEvent = async (event: CapiEventData): Promise<MetaDeliveryResult> => {
  const fallbackEventId = event.eventId || event.orderId || 'event_rejected';
  if (event.marketingConsent !== true) {
    return { accepted: false, delivered: false, eventId: fallbackEventId };
  }

  const { payload, eventId } = buildPayload(event);
  const normalizedEvent: CapiEventData = {
    ...event,
    eventId,
    eventTime: payload.data[0].event_time,
  };
  const persisted = await persistPendingEvent(normalizedEvent, eventId);
  if (!persisted.persisted) return { accepted: false, delivered: false, eventId };
  if (persisted.alreadyDelivered) return { accepted: true, delivered: true, eventId };
  if (!persisted.claimed) return { accepted: true, delivered: false, eventId };

  const result = await sendOnce(payload, event.eventName);

  if (result.ok) {
    await MetaEventDlq.updateOne(
      { eventId, outboxVersion: 2 },
      {
        $set: { status: 'sent', attempts: 1, deliveryMode: 'direct' },
        $unset: { payload: '', lastError: '', directSendClaim: '' },
      },
    );
    logger.info(`[Meta CAPI OK] Evento '${event.eventName}' enviado con exito. EventID: ${eventId}`);
    return { accepted: true, delivered: true, eventId };
  }

  logger.warn(`[Meta CAPI] Fallo envio directo de '${event.eventName}' (${eventId}): ${result.error}`);
  await MetaEventDlq.updateOne(
    { eventId, outboxVersion: 2 },
    {
      $set: {
        status: 'pending',
        attempts: 1,
        lastError: result.error ?? 'unknown',
        nextRetryAt: new Date(Date.now() + BASE_BACKOFF_MS),
      },
      $unset: { directSendClaim: '' },
    },
  );
  return { accepted: true, delivered: false, eventId };
};

export const processDlqBatch = async (limit = 50): Promise<{ sent: number; failed: number }> => {
  // Retain delivery metadata for operations, but remove CAPI payloads once an
  // event is terminal. This also scrubs terminal records created by older code.
  await MetaEventDlq.updateMany(
    { status: { $in: ['sent', 'failed', 'exhausted'] }, payload: { $exists: true } },
    { $unset: { payload: '' } },
  );
  await MetaEventDlq.updateMany(
    { status: 'pending', attempts: { $gte: MAX_ATTEMPTS } },
    {
      $set: {
        status: 'exhausted',
        lastError: 'Evento descartado: límite de reintentos alcanzado',
      },
      $unset: { payload: '' },
    },
  );

  if (!getAccessToken() || !getPixelId()) {
    logger.warn('[Meta CAPI DLQ] No se puede procesar: credenciales de Meta no configuradas');
    return { sent: 0, failed: 0 };
  }

  const now = new Date();
  const pending = await MetaEventDlq.find({
    status: 'pending',
    nextRetryAt: { $lte: now },
  }).limit(limit);

  let sent = 0;
  let failed = 0;

  for (const doc of pending) {
    if (!doc.payload) {
      await MetaEventDlq.updateOne(
        { _id: doc._id },
        { $set: { status: 'exhausted', lastError: 'Evento sin payload recuperable' } },
      );
      failed++;
      continue;
    }
    const event = doc.payload as unknown as CapiEventData;
    const consentIsCurrent = event.marketingConsent === true
      && await hasCurrentMetaMarketingConsent(event.externalId, META_MARKETING_CONSENT_VERSION);
    if (!consentIsCurrent) {
      await MetaEventDlq.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: 'exhausted',
            lastError: 'Evento descartado: no hay consentimiento publicitario vigente',
          },
          $unset: { payload: '' },
        },
      );
      continue;
    }

    const { payload } = buildPayload(event);
    const result = await sendOnce(payload, doc.eventName as CapiEventName);

    if (result.ok) {
      await MetaEventDlq.updateOne(
        { _id: doc._id },
        {
          $set: { status: 'sent', deliveryMode: 'retry' },
          $unset: { payload: '', lastError: '' },
        },
      );
      sent++;
      logger.info(`[Meta CAPI DLQ] Reenviado OK: ${doc.eventName} (${doc.eventId})`);
    } else {
      const attempts = doc.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempts);
      await MetaEventDlq.updateOne(
        { _id: doc._id },
        {
          $set: {
            attempts,
            lastError: result.error,
            nextRetryAt: new Date(Date.now() + backoff),
            ...(exhausted ? { status: 'exhausted' } : {}),
          },
          ...(exhausted ? { $unset: { payload: '' } } : {}),
        },
      );
      failed++;
    }
  }

  if (pending.length > 0) {
    logger.info(`[Meta CAPI DLQ] Procesados ${pending.length}: ${sent} OK, ${failed} con error`);
  }
  return { sent, failed };
};
