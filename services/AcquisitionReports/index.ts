import { hasVisitFilters } from './attribution.js';
import type { ReportQuery } from './filters.js';
import { buildEnvelope, DAY_MS, ratio } from './envelope.js';
import { runPeriodPipeline, runVisitPipeline } from './runners.js';
import { resolveRange } from './range.js';
import type { ReportRange } from './range.js';
import type {
  ChannelRow,
  ChannelsData,
  Outcomes,
  OverviewData,
  RawChannelRow,
  Rates,
  ReportResponse,
  Totals,
} from './types.js';

const UNLINKED = 'unlinked';

const emptyOutcomes = (): Outcomes => ({ leads: 0, purchases: 0, partialPayments: 0, revenue: 0 });

const addOutcomes = (a: Outcomes, b: Outcomes): Outcomes => ({
  leads: a.leads + b.leads,
  purchases: a.purchases + b.purchases,
  partialPayments: a.partialPayments + b.partialPayments,
  revenue: a.revenue + b.revenue,
});

const pickOutcomes = ({ leads, purchases, partialPayments, revenue }: Outcomes): Outcomes => ({ leads, purchases, partialPayments, revenue });

/** Conversion rates only exist when visits and outcomes share one cohort. */
const ratesOf = (visits: number, outcomes: Outcomes, isCohort: boolean): Rates => ({
  leadRate: isCohort ? ratio(outcomes.leads, visits) : null,
  purchaseRate: isCohort ? ratio(outcomes.purchases, visits) : null,
  averageTicket: ratio(outcomes.revenue, outcomes.purchases),
});

interface ReportData {
  channels: ChannelRow[];
  totals: Totals;
  unlinked: Outcomes | null;
  knownVisits: number;
  isCohort: boolean;
}

const rowKey = (channel: string, platform: string) => `${channel}\u0000${platform}`;

const buildReport = async (filters: ReportQuery, range: ReportRange): Promise<ReportData> => {
  const isCohort = filters.reportingMode === 'acquisition_cohort';
  const windowMs = isCohort ? filters.outcomeWindowDays * DAY_MS : undefined;

  const [visits, periodRows] = await Promise.all([
    runVisitPipeline(range, filters, windowMs),
    isCohort ? Promise.resolve([]) : runPeriodPipeline(range, filters),
  ]);

  const merged = new Map<string, RawChannelRow>();
  for (const row of visits.rows) merged.set(rowKey(row.channel, row.platform), row);

  let unlinked: Outcomes | null = null;
  for (const row of periodRows) {
    if (row.channel === UNLINKED) {
      unlinked = pickOutcomes(row);
      continue;
    }
    const key = rowKey(row.channel, row.platform);
    const base = merged.get(key) ?? { channel: row.channel, platform: row.platform, visits: 0, visitors: 0, known: 0, ...emptyOutcomes() };
    merged.set(key, { ...base, ...pickOutcomes(row) });
  }
  // Unlinked conversions cannot match a visit filter, so they only exist for unfiltered period reports.
  if (!isCohort) unlinked = hasVisitFilters(filters) ? null : (unlinked ?? emptyOutcomes());

  const raw = [...merged.values()];
  const outcomes = raw.reduce((sum, row) => addOutcomes(sum, row), unlinked ?? emptyOutcomes());
  const totalVisits = raw.reduce((sum, row) => sum + row.visits, 0);

  const channels: ChannelRow[] = raw
    .map((row) => ({
      channelGroup: row.channel,
      sourcePlatform: row.platform,
      visits: row.visits,
      visitors: row.visitors,
      ...pickOutcomes(row),
      ...ratesOf(row.visits, row, isCohort),
      revenueShare: ratio(row.revenue, outcomes.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || b.visits - a.visits || a.channelGroup.localeCompare(b.channelGroup) || a.sourcePlatform.localeCompare(b.sourcePlatform));

  return {
    channels,
    unlinked,
    isCohort,
    knownVisits: raw.reduce((sum, row) => sum + row.known, 0),
    totals: { visits: totalVisits, visitors: visits.distinctVisitors, ...outcomes, ...ratesOf(totalVisits, outcomes, isCohort) },
  };
};

const toResponse = <T>(filters: ReportQuery, range: ReportRange, report: ReportData, now: Date, data: T): ReportResponse<T> => ({
  ...buildEnvelope(filters, range, now, data),
  coverage: {
    observedConsentedVisits: report.totals.visits,
    knownChannelVisits: report.knownVisits,
    attributionCoverage: ratio(report.knownVisits, report.totals.visits),
    totalSiteVisits: null,
    measurementCoverage: null,
  },
});

export const getChannelsReport = async (filters: ReportQuery, now = new Date()): Promise<ReportResponse<ChannelsData>> => {
  const range = resolveRange(filters);
  const report = await buildReport(filters, range);
  return toResponse(filters, range, report, now, { channels: report.channels, totals: report.totals, unlinked: report.unlinked });
};

export const getOverviewReport = async (filters: ReportQuery, now = new Date()): Promise<ReportResponse<OverviewData>> => {
  const range = resolveRange(filters);
  const report = await buildReport(filters, range);
  const { totals } = report;
  const data: OverviewData = {
    visits: totals.visits,
    visitors: totals.visitors,
    attributableVisits: report.knownVisits,
    leads: totals.leads,
    purchases: totals.purchases,
    partialPayments: totals.partialPayments,
    revenue: totals.revenue,
    leadRate: totals.leadRate,
    purchaseRate: totals.purchaseRate,
    averageTicket: totals.averageTicket,
    unlinked: report.unlinked,
  };
  return toResponse(filters, range, report, now, data);
};

export { getFunnelReport } from './funnel.js';
export { getJourneyDetail, getJourneys } from './journeys.js';
export { getLiveReport } from './live.js';
export { getQualityReport } from './quality.js';
