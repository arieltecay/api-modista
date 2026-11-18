export type ReportingMode = 'acquisition_cohort' | 'event_period';
export type Perspective = 'visit_touch' | 'first_touch' | 'last_non_direct';

export interface Outcomes {
  leads: number;
  purchases: number;
  partialPayments: number;
  revenue: number;
}

export interface Rates {
  leadRate: number | null;
  purchaseRate: number | null;
  averageTicket: number | null;
}

export interface ChannelRow extends Outcomes, Rates {
  channelGroup: string;
  sourcePlatform: string;
  visits: number;
  visitors: number;
  revenueShare: number | null;
}

export interface Totals extends Outcomes, Rates {
  visits: number;
  visitors: number;
}

export interface Coverage {
  observedConsentedVisits: number;
  knownChannelVisits: number;
  attributionCoverage: number | null;
  /** Needs an independent source (Cloudflare analytics/logs); null until one is connected. */
  totalSiteVisits: null;
  measurementCoverage: null;
}

export interface ReportEnvelope<T> {
  generatedAt: string;
  timezone: string;
  reportingMode: ReportingMode;
  outcomeWindowDays: 7 | 30 | null;
  /** Cohort mode only: false while some visits of the range have not finished their outcome window. */
  outcomesComplete: boolean | null;
  perspective: Perspective;
  range: ReportRangeInfo;
  data: T;
}

export interface ReportRangeInfo {
  from: string;
  to: string;
  fromUtc: string;
  toExclusiveUtc: string;
}

export interface ReportResponse<T> extends ReportEnvelope<T> {
  coverage: Coverage;
}

export interface FunnelStepRow {
  step: string;
  visits: number;
  conversionFromPrevious: number | null;
  conversionFromTop: number | null;
}

export interface FunnelData {
  steps: FunnelStepRow[];
  /** True for event_period: each step counts its own events, so steps are not a subset chain. */
  independentCounts: boolean;
}

export interface LiveData {
  activeVisits: number;
  eventsInWindow: number;
  activeByChannel: Array<{ channelGroup: string; count: number }>;
  eventsPerMinute: Array<{ minute: string; count: number }>;
  recentEvents: Array<{ name: string; at: string; visit: string; channelGroup: string | null; path?: string; courseId?: string }>;
}

export interface LiveResponse {
  generatedAt: string;
  windowMinutes: number;
  data: LiveData;
}

export interface JourneyRow {
  visitId: string;
  startedAt: string;
  lastActivityAt: string;
  channelGroup: string;
  sourcePlatform: string;
  device: string;
  maxStep: string;
  hasLead: boolean;
  hasPurchase: boolean;
  revenue: number;
  eventCount: number;
  landingSlug?: string;
}

export interface JourneysResponse {
  generatedAt: string;
  timezone: string;
  range: ReportRangeInfo;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  data: { journeys: JourneyRow[] };
}

export interface JourneyDetailData {
  visit: {
    visitId: string;
    startedAt: string;
    lastActivityAt: string;
    entryPath: string;
    channelGroup: string;
    sourcePlatform: string;
    acquisitionType: string;
    reason: string;
    device: string;
    hasFbc: boolean;
    hasFbp: boolean;
    rawAttribution: { source?: string; medium?: string; campaign?: string };
    landingSlug?: string;
    referrerHost?: string;
  };
  events: Array<{ name: string; occurredAt: string; source: string; path?: string; courseId?: string }>;
  conversions: Array<{ inscriptionId: string; paymentStatus: string; collected: number }>;
}

export interface JourneyDetailResponse {
  generatedAt: string;
  data: JourneyDetailData;
}

export type QualitySeverity = 'info' | 'warning' | 'critical';

export interface QualityRule {
  code: string;
  severity: QualitySeverity;
  affected: number;
  universe: number;
  percentage: number | null;
  firstOccurrence: string | null;
  lastOccurrence: string | null;
  explanation: string;
  action: string;
}

export interface QualityData {
  rules: QualityRule[];
  /** Every rule that was checked, so an empty `rules` means "all clear" and not "not checked". */
  evaluated: string[];
  capi: { accepted: number; delivered: number; pending: number; retry: number; exhausted: number };
  identifiers: { visits: number; withFbc: number; withFbp: number; fbcCoverage: number | null; fbpCoverage: number | null };
  tracking: { lastActivityAt: string | null; stale: boolean };
}

export interface QualityResponse {
  generatedAt: string;
  timezone: string;
  range: ReportRangeInfo;
  data: QualityData;
}

export interface ChannelsData {
  channels: ChannelRow[];
  totals: Totals;
  /** Event-period conversions with no linkable visit; null when not computable or filtered out. */
  unlinked: Outcomes | null;
}

export interface OverviewData extends Outcomes, Rates {
  visits: number;
  visitors: number;
  attributableVisits: number;
  unlinked: Outcomes | null;
}

/** Raw rows coming out of the Mongo pipelines, before rates and shares are derived. */
export interface RawChannelRow extends Outcomes {
  channel: string;
  platform: string;
  visits: number;
  visitors: number;
  known: number;
}

export interface VisitPipelineResult {
  rows: RawChannelRow[];
  distinctVisitors: number;
}
