export const ACQUISITION_EVENT_NAMES = [
  'page_view',
  'course_detail_view',
  'pricing_visible',
  'cta_click',
  'form_view',
  'form_start',
  'form_submit',
  'lead',
  'initiate_checkout',
  'redirect_to_payment',
  'purchase',
  'scroll_50',
  'scroll_90',
] as const;

export type AcquisitionEventName = (typeof ACQUISITION_EVENT_NAMES)[number];

export type AcquisitionEventSource = 'browser' | 'server' | 'backfill';

export interface AcquisitionEventPersistence {
  eventId: string;
  visitId: string;
  visitorId: string;
  name: AcquisitionEventName;
  occurredAt: Date;
  receivedAt: Date;
  source: AcquisitionEventSource;
  schemaVersion: number;
  path?: string;
  landingSlug?: string;
  courseId?: string;
  inscriptionId?: string;
  value?: number;
  currency?: 'ARS';
}
