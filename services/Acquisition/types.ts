export type SourcePlatform =
  | 'facebook'
  | 'instagram'
  | 'google'
  | 'whatsapp'
  | 'email'
  | 'tiktok'
  | 'youtube'
  | 'bing'
  | 'other'
  | 'unknown';

export type AcquisitionType =
  | 'paid'
  | 'organic_social'
  | 'organic_search'
  | 'referral'
  | 'direct'
  | 'email'
  | 'messaging'
  | 'unknown';

export type ChannelGroup =
  | 'meta_paid'
  | 'instagram_organic'
  | 'facebook_organic'
  | 'google_paid'
  | 'google_organic'
  | 'whatsapp'
  | 'email'
  | 'referral'
  | 'direct'
  | 'other_paid'
  | 'other_social'
  | 'other_search'
  | 'unknown';

/** Family a platform or host belongs to; drives the organic social/search/messaging/email rules. */
export type PlatformKind = 'social' | 'search' | 'messaging' | 'email';

/**
 * Click ids (`fbclid`, `fbc`) are intentionally not accepted: they never imply a paid visit.
 * Own-domain and payment-gateway referrers must be dropped by the caller before classifying.
 */
export interface ClassifierInput {
  /** Campaign names (any casing) the business explicitly flagged as paid. */
  paidCampaigns?: readonly string[];
  source?: string;
  medium?: string;
  campaign?: string;
  /** Host or URL of the referrer; the classifier reduces it to a bare host. */
  referrerHost?: string;
}

/** Stable rule codes; never free text. */
export type ClassificationReason =
  | 'paid_medium'
  | 'paid_campaign_mapped'
  | 'paid_source_alias'
  | 'paid_signal_without_platform'
  | 'paid_signal_unrecognized_platform'
  | 'paid_signal_contradicts_email_source'
  | 'source_medium_conflict'
  | 'email_medium'
  | 'email_source'
  | 'messaging'
  | 'social_medium'
  | 'social_medium_without_platform'
  | 'social_source_without_paid_medium'
  | 'social_referrer'
  | 'search_medium'
  | 'search_source_without_paid_medium'
  | 'search_referrer'
  | 'referral_medium'
  | 'referral_referrer'
  | 'direct_no_signals'
  | 'unrecognized_attribution';

export interface Classification {
  sourcePlatform: SourcePlatform;
  acquisitionType: AcquisitionType;
  channelGroup: ChannelGroup;
  reason: ClassificationReason;
  classifierVersion: number;
}

export interface HostMatch {
  platform: SourcePlatform;
  kind: PlatformKind;
  /** The source name itself says it is an ad (`facebook_ads`, `adwords`). */
  ad?: boolean;
}

/** Source names of one platform; `name_*` also matches (`ig_stories`), and an `ads` token flags an ad. */
export interface SourceFamily {
  names: readonly string[];
  match: HostMatch;
}

/** Normalized view of `ClassifierInput` shared by every rule. */
export interface Signals {
  platform: SourcePlatform;
  platformOrigin: 'source' | 'referrer';
  paidCampaign: boolean;
  sourceIsAd: boolean;
  source: string;
  medium: string;
  campaign: string;
  referrerHost: string;
  kind?: PlatformKind;
}

export type ClassificationRule = (signals: Signals) => Classification | undefined;

/** Result of an idempotent write: first time, repeat, or an id owned by another visitor. */
export type IngestOutcome = 'created' | 'updated' | 'conflict';

export type ServerCapiStatus = 'accepted' | 'delivered' | 'pending' | 'retry' | 'exhausted';

export interface ServerCapiSignalInput {
  eventId: string;
  status: ServerCapiStatus;
  occurredAt: Date;
  attempts?: number;
  visitorId?: string;
}

/** Only the outbox fields the projection needs; payloads are never read. */
export interface OutboxSnapshot {
  status: string;
  attempts: number;
}

/** What the Meta helper knows about an event it is about to send or has just sent. */
export interface MetaProjectionInput {
  eventName: string;
  eventId: string;
  occurredAt: Date;
  visitorId?: string;
  inscriptionId?: string;
  courseId?: string;
}

export interface MetaDeliveryOutcome {
  accepted: boolean;
  delivered: boolean;
}
