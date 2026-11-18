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

export interface ReportResponse<T> {
  generatedAt: string;
  timezone: string;
  reportingMode: ReportingMode;
  outcomeWindowDays: 7 | 30 | null;
  /** Cohort mode only: false while some visits of the range have not finished their outcome window. */
  outcomesComplete: boolean | null;
  perspective: Perspective;
  range: { from: string; to: string; fromUtc: string; toExclusiveUtc: string };
  coverage: Coverage;
  data: T;
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
