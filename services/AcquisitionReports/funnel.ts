import type { PipelineStage } from 'mongoose';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { attributedFilter, attributionStages, hasVisitFilters, stage, visitFilterMatch, visitsInRange } from './attribution.js';
import { buildEnvelope, DAY_MS, ratio } from './envelope.js';
import type { FunnelQuery } from './filters.js';
import { QUERY_OPTIONS, runVisitPipeline } from './runners.js';
import { resolveRange } from './range.js';
import type { ReportRange } from './range.js';
import { FUNNEL_STEPS } from './steps.js';
import type { FunnelData, FunnelStepRow, ReportEnvelope } from './types.js';

/** Per visit, the index of the furthest funnel step among its events inside the outcome window. */
const cohortFunnelPipeline = (range: ReportRange, filters: FunnelQuery, windowMs: number): PipelineStage[] => [
  visitsInRange(range, filters),
  ...attributionStages(filters.perspective, ''),
  ...attributedFilter(filters),
  stage({
    $lookup: {
      from: AcquisitionEvent.collection.name,
      let: { visit: '$visitId', started: '$startedAt' },
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$visitId', '$$visit'] }, { $lt: ['$occurredAt', { $add: ['$$started', windowMs] }] }] } } },
        { $project: { _id: 0, name: 1, courseId: 1 } },
      ],
      as: '__events',
    },
  }),
  ...(filters.course === undefined ? [] : [stage({ $match: { __events: { $elemMatch: { courseId: filters.course } } } })]),
  stage({
    $group: {
      _id: { $max: { $map: { input: '$__events', as: 'event', in: { $indexOfArray: [[...FUNNEL_STEPS], '$$event.name'] } } } },
      visits: { $sum: 1 },
    },
  }),
];

/** Distinct visits that had each step inside the range, whatever the date of the visit. */
const periodFunnelPipeline = (range: ReportRange, filters: FunnelQuery): PipelineStage[] => [
  stage({
    $match: {
      occurredAt: { $gte: range.from, $lt: range.toExclusive },
      name: { $in: [...FUNNEL_STEPS] },
      ...(filters.course === undefined ? {} : { courseId: filters.course }),
    },
  }),
  stage({ $group: { _id: { visit: '$visitId', name: '$name' } } }),
  stage({ $lookup: { from: AcquisitionVisit.collection.name, localField: '_id.visit', foreignField: 'visitId', as: 'visit' } }),
  stage({ $unwind: '$visit' }),
  ...(hasVisitFilters(filters) ? [stage({ $match: visitFilterMatch(filters, 'visit.') })] : []),
  ...attributionStages(filters.perspective, 'visit.'),
  ...attributedFilter(filters),
  stage({ $group: { _id: '$_id.name', visits: { $sum: 1 } } }),
];

const toRows = (top: number, reached: number[], isCohort: boolean): FunnelStepRow[] => [
  { step: 'visit', visits: top, conversionFromPrevious: null, conversionFromTop: isCohort ? ratio(top, top) : null },
  ...FUNNEL_STEPS.map((step, index) => ({
    step,
    visits: reached[index],
    conversionFromPrevious: isCohort ? ratio(reached[index], index === 0 ? top : reached[index - 1]) : null,
    conversionFromTop: isCohort ? ratio(reached[index], top) : null,
  })),
];

export const getFunnelReport = async (filters: FunnelQuery, now = new Date()): Promise<ReportEnvelope<FunnelData>> => {
  const range = resolveRange(filters);

  if (filters.reportingMode === 'acquisition_cohort') {
    const grouped = await AcquisitionVisit.aggregate<{ _id: number | null; visits: number }>(
      cohortFunnelPipeline(range, filters, filters.outcomeWindowDays * DAY_MS),
    ).option(QUERY_OPTIONS);
    const furthest = grouped.map((row) => ({ index: row._id ?? -1, visits: row.visits }));
    const top = furthest.reduce((sum, row) => sum + row.visits, 0);
    // A visit that reached a step is counted at every earlier step too, so the funnel is monotone.
    const reached = FUNNEL_STEPS.map((_, step) => furthest.filter((row) => row.index >= step).reduce((sum, row) => sum + row.visits, 0));
    return buildEnvelope(filters, range, now, { steps: toRows(top, reached, true), independentCounts: false });
  }

  const [counts, visits] = await Promise.all([
    AcquisitionEvent.aggregate<{ _id: string; visits: number }>(periodFunnelPipeline(range, filters)).option(QUERY_OPTIONS),
    runVisitPipeline(range, filters, undefined),
  ]);
  const byStep = new Map(counts.map((row) => [row._id, row.visits]));
  const top = visits.rows.reduce((sum, row) => sum + row.visits, 0);
  const reached = FUNNEL_STEPS.map((step) => byStep.get(step) ?? 0);
  return buildEnvelope(filters, range, now, { steps: toRows(top, reached, false), independentCounts: true });
};
