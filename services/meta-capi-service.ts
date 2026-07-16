import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger.js';

/**
 * Meta Conversions API (CAPI) Service
 */

const PIXEL_ID = process.env.META_PIXEL_ID || '2480923435759693';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const API_VERSION = 'v21.0';
const API_URL = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

/**
 * Hashes data using SHA256 as required by Meta
 */
const hashData = (data: string | undefined): string | null => {
  if (!data) return null;
  return crypto
    .createHash('sha256')
    .update(data.trim().toLowerCase())
    .digest('hex');
};

interface CapiEventData {
  eventName: 'InitiateCheckout' | 'Purchase' | 'Lead';
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  value?: number;
  currency?: string;
  contentName?: string;
  orderId?: string;
  fbc?: string;
  fbp?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  eventSourceUrl?: string;
  eventId?: string;
  contentIds?: string[];
  testEventCode?: string;
}

/**
 * Sends a conversion event to Meta
 */
export const sendMetaConversionEvent = async (event: CapiEventData): Promise<boolean> => {
  if (!ACCESS_TOKEN) {
    logger.warn('[Meta CAPI] No se pudo enviar evento: Falta META_ACCESS_TOKEN');
    return false;
  }

  try {
    const eventTime = Math.floor(Date.now() / 1000);
    
    // Preparar datos del usuario con hashing SHA256
    const userData = {
      em: [hashData(event.email)],
      ph: event.phone ? [hashData(event.phone)] : undefined,
      fn: event.firstName ? [hashData(event.firstName)] : undefined,
      ln: event.lastName ? [hashData(event.lastName)] : undefined,
      client_ip_address: event.clientIpAddress,
      client_user_agent: event.clientUserAgent,
      fbc: event.fbc,
      fbp: event.fbp,
    };

    // Preparar datos personalizados
    const customData = {
      value: event.value,
      currency: event.currency || 'ARS',
      content_name: event.contentName,
      content_ids: event.contentIds,
      order_id: event.orderId,
    };

    const eventId = event.eventId || event.orderId || `event_${eventTime}_${Math.random().toString(36).substr(2, 9)}`;

    const payload: any = {
      data: [
        {
          event_name: event.eventName,
          event_time: eventTime,
          action_source: 'website',
          event_source_url: event.eventSourceUrl || 'https://modista-app.com',
          user_data: userData,
          custom_data: customData,
          event_id: eventId,
        },
      ],
      access_token: ACCESS_TOKEN,
    };

    if (event.testEventCode) payload.test_event_code = event.testEventCode;

    const response = await axios.post(API_URL, payload);

    if (response.data.fbtrace_id) {
      logger.info(`[Meta CAPI OK] Evento '${event.eventName}' enviado con éxito. Trace ID: ${response.data.fbtrace_id}`);
      return true;
    }

    return false;
  } catch (error: any) {
    const errorDetail = error.response?.data || error.message;
    logger.error('[Meta CAPI Error] Fallo al enviar evento a Meta:', { 
      eventName: event.eventName, 
      detail: errorDetail 
    });
    return false;
  }
};
