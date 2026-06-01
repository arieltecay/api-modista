/**
 * Instagram Messaging API Types (Meta Graph API)
 * 
 * Documentación: 
 * - https://developers.facebook.com/docs/instagram-api/reference/ig-user/messages
 * - https://developers.facebook.com/docs/messenger-platform/webhook
 */

// ─── Webhook Payload ─────────────────────────────────────

export interface InstagramSender {
  id: string; // IG-scoped user ID
}

export interface InstagramRecipient {
  id: string; // Your IG Business Account ID
}

export interface InstagramMessageAttachmentPayload {
  url: string;
}

export interface InstagramMessageAttachment {
  type: 'image' | 'video' | 'audio' | 'file';
  payload: InstagramMessageAttachmentPayload;
}

export interface InstagramMessage {
  mid: string;                // Message ID
  text?: string;              // Text content (if text message)
  attachments?: InstagramMessageAttachment[]; // Media attachments
  quick_reply?: {
    payload: string;
  };
  reply_to?: {
    mid: string;
    story_id?: string;
  };
}

export interface InstagramMessagingEntry {
  sender: InstagramSender;
  recipient: InstagramRecipient;
  timestamp: number;
  message: InstagramMessage;
}

export interface InstagramWebhookChangeValue {
  messaging_product: 'instagram';
  metadata: {
    sender_id: string;
    recipient_id: string;
    business_acct_id?: string;
  };
  messages?: Array<{
    id: string;
    from: string;
    text?: { body: string };
    type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'like';
    reply_to?: { message_id: string; story_id?: string };
    attachments?: Array<{
      type: string;
      payload: { url: string; sticker_id?: number };
    }>;
  }>;
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
}

export interface InstagramWebhookEntry {
  id: string;
  time: number;
  messaging?: InstagramMessagingEntry[];   // Formato legacy (v1)
  changes?: Array<{
    field: 'messages';
    value: InstagramWebhookChangeValue;    // Formato Cloud API (v2)
  }>;
}

export interface InstagramWebhookPayload {
  object: 'instagram';
  entry: InstagramWebhookEntry[];
}

// ─── Send Message Request ────────────────────────────────

export interface InstagramSendMessageRequest {
  recipient: {
    id: string;
  };
  message: {
    text: string;
  };
  messaging_type?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
  tag?: 'CONFIRMED_EVENT_UPDATE' | 'POST_PURCHASE_UPDATE' | 'ACCOUNT_UPDATE' 
      | 'HUMAN_AGENT' | 'SHIPPING_UPDATE' | 'RESERVATION_UPDATE' 
      | 'ISSUE_RESOLUTION' | 'APPOINTMENT_UPDATE' | 'GAME_EVENT' 
      | 'TRANSPORTATION_UPDATE' | 'FEATURE_FUNCTIONALITY_UPDATE' 
      | 'TICKET_UPDATE' | 'PAYMENT_UPDATE';
}

export interface InstagramSendMessageResponse {
  message_id: string;
  recipient_id: string;
}

// ─── Enums ────────────────────────────────────────────────

export type InstagramMessageTag = 
  | 'CONFIRMED_EVENT_UPDATE' 
  | 'POST_PURCHASE_UPDATE' 
  | 'ACCOUNT_UPDATE' 
  | 'HUMAN_AGENT';

export type InstagramMessagingType = 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
