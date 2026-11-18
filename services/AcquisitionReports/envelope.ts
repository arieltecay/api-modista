import type { ReportQuery } from './filters.js';
import type { ReportRange } from './range.js';
import type { ReportEnvelope, ReportRangeInfo } from './types.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const ratio = (numerator: number, denominator: number): number | null => (denominator > 0 ? numerator / denominator : null);

export const rangeInfo = (filters: { from: string; to: string }, range: ReportRange): ReportRangeInfo => ({
  from: filters.from,
  to: filters.to,
  fromUtc: range.from.toISOString(),
  toExclusiveUtc: range.toExclusive.toISOString(),
});

export const buildEnvelope = <T>(filters: ReportQuery, range: ReportRange, now: Date, data: T): ReportEnvelope<T> => {
  const isCohort = filters.reportingMode === 'acquisition_cohort';
  return {
    generatedAt: now.toISOString(),
    timezone: range.timezone,
    reportingMode: filters.reportingMode,
    outcomeWindowDays: isCohort ? filters.outcomeWindowDays : null,
    outcomesComplete: isCohort ? range.toExclusive.getTime() + filters.outcomeWindowDays * DAY_MS <= now.getTime() : null,
    perspective: filters.perspective,
    range: rangeInfo(filters, range),
    data,
  };
};
