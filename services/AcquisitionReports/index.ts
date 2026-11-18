import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';
import { hasVisitFilters } from './attribution.js';
import type { ReportQuery } from './filters.js';
import { periodOutcomePipeline, visitPipeline } from './pipelines.js';
import { resolveRange } from './range.js';
import type { ReportRange } from './range.js';
import type {
  ChannelRow,
  ChannelsData,
  Coverage,
  Outcomes,
  OverviewData,
  RawChannelRow,
  Rates,
  ReportResponse,
  Totals,
  VisitPipelineResult,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 20_000;
const QUERY_OPTIONS = { maxTimeMS: QUERY_TIMEOUT_MS, allowDiskUse: true };
const UNLINKED = 'unlinked';

const ratio = (numerator: number, denominator: number): number | null => (denominator > 0 ? numerator / denominator : null);

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

const runVisitPipeline = async (range: ReportRange, filters: ReportQuery, windowMs: number | undefined): Promise<VisitPipelineResult> => {
  const [result] = await AcquisitionVisit.aggregate<{ rows: RawChannelRow[]; distinct: Array<{ count: number }> }>(
    visitPipeline(range, filters, windowMs),
  ).option(QUERY_OPTIONS);
  return { rows: result?.rows ?? [], distinctVisitors: result?.distinct[0]?.count ?? 0 };
};

const runPeriodPipeline = (range: ReportRange, filters: ReportQuery) =>
  Inscription.aggregate<Outcomes & { channel: string; platform: string }>(periodOutcomePipeline(range, filters)).option(QUERY_OPTIONS);

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

const toResponse = <T>(filters: ReportQuery, range: ReportRange, report: ReportData, now: Date, data: T): ReportResponse<T> => {
  const windowMs = filters.outcomeWindowDays * DAY_MS;
  const coverage: Coverage = {
    observedConsentedVisits: report.totals.visits,
    knownChannelVisits: report.knownVisits,
    attributionCoverage: ratio(report.knownVisits, report.totals.visits),
    totalSiteVisits: null,
    measurementCoverage: null,
  };

  return {
    generatedAt: now.toISOString(),
    timezone: range.timezone,
    reportingMode: filters.reportingMode,
    outcomeWindowDays: report.isCohort ? filters.outcomeWindowDays : null,
    outcomesComplete: report.isCohort ? range.toExclusive.getTime() + windowMs <= now.getTime() : null,
    perspective: filters.perspective,
    range: { from: filters.from, to: filters.to, fromUtc: range.from.toISOString(), toExclusiveUtc: range.toExclusive.toISOString() },
    coverage,
    data,
  };
};

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
