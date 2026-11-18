import type { PipelineStage } from 'mongoose';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { attributedFilter, attributionStages, hasVisitFilters, stage, visitFilterMatch, visitsInRange } from './attribution.js';
import type { ReportQuery } from './filters.js';
import { collectedIn, completedIn, createdIn, inscriptionsLookup, partialIn } from './payments.js';
import type { ReportRange } from './range.js';

const SUM_OUTCOMES = {
  leads: { $sum: '$leads' },
  purchases: { $sum: '$purchases' },
  partialPayments: { $sum: '$partialPayments' },
  revenue: { $sum: '$revenue' },
};

/**
 * Per visit: its leads inside the outcome window (a lead whose inscription no longer exists does
 * not count) and what those inscriptions completed or collected inside the same window.
 */
const cohortOutcomeStages = (windowMs: number): PipelineStage[] => {
  const start = '$startedAt';
  const end = { $add: ['$startedAt', windowMs] };
  return [
    stage({
      $lookup: {
        from: AcquisitionEvent.collection.name,
        let: { visit: '$visitId', started: '$startedAt' },
        pipeline: [
          // Linked by visitId, so no lower bound: a client clock ahead of the server must not drop the lead.
          { $match: { $expr: { $and: [{ $eq: ['$visitId', '$$visit'] }, { $eq: ['$name', 'lead'] }, { $lt: ['$occurredAt', { $add: ['$$started', windowMs] }] }] } } },
          { $project: { _id: 0, inscriptionId: 1 } },
        ],
        as: '__leads',
      },
    }),
    stage({
      $addFields: {
        __inscriptionIds: { $map: { input: '$__leads', as: 'lead', in: { $convert: { input: '$$lead.inscriptionId', to: 'objectId', onError: null, onNull: null } } } },
      },
    }),
    inscriptionsLookup('__inscriptionIds', '__inscriptions'),
    stage({
      $addFields: {
        leads: { $size: '$__inscriptions' },
        purchases: { $size: { $filter: { input: '$__inscriptions', as: 'i', cond: completedIn('$$i', start, end) } } },
        partialPayments: { $size: { $filter: { input: '$__inscriptions', as: 'i', cond: partialIn('$$i', start, end) } } },
        revenue: { $sum: { $map: { input: '$__inscriptions', as: 'i', in: collectedIn('$$i', start, end) } } },
      },
    }),
    stage({ $project: { __leads: 0, __inscriptionIds: 0, __inscriptions: 0 } }),
  ];
};

/**
 * Visits of the range grouped by attributed channel/platform, with the distinct visitor count.
 * With `windowMs` it also carries the outcomes of the cohort (acquisition_cohort mode).
 */
export const visitPipeline = (range: ReportRange, filters: ReportQuery, windowMs: number | undefined): PipelineStage[] => [
  visitsInRange(range, filters),
  ...attributionStages(filters.perspective, ''),
  ...attributedFilter(filters),
  ...(windowMs === undefined ? [] : cohortOutcomeStages(windowMs)),
  stage({
    $facet: {
      rows: [
        {
          $group: {
            _id: { channel: '$attributedChannel', platform: '$attributedPlatform', visitor: '$visitorId' },
            visits: { $sum: 1 },
            known: { $sum: { $cond: [{ $ne: ['$classification.channelGroup', 'unknown'] }, 1, 0] } },
            ...SUM_OUTCOMES,
          },
        },
        {
          $group: {
            _id: { channel: '$_id.channel', platform: '$_id.platform' },
            visitors: { $sum: 1 },
            visits: { $sum: '$visits' },
            known: { $sum: '$known' },
            ...SUM_OUTCOMES,
          },
        },
        { $project: { _id: 0, channel: '$_id.channel', platform: '$_id.platform', visitors: 1, visits: 1, known: 1, leads: 1, purchases: 1, partialPayments: 1, revenue: 1 } },
      ],
      distinct: [{ $group: { _id: '$visitorId' } }, { $count: 'count' }],
    },
  }),
];

/**
 * event_period outcomes: inscriptions created or paid inside the range, credited to the visit their
 * lead came from (any date) and counted by when each event happened. Inscriptions with no lead
 * event end up in the `unlinked` bucket.
 */
export const periodOutcomePipeline = (range: ReportRange, filters: ReportQuery): PipelineStage[] => {
  const { from, toExclusive: to } = range;
  const inRange = { $gte: from, $lt: to };
  const whole = '$$i';
  const wrap = (expression: unknown) => ({ $let: { vars: { i: '$$ROOT' }, in: expression } });

  return [
    stage({ $match: { $or: [{ fechaInscripcion: inRange }, { paymentHistory: { $elemMatch: { date: inRange } } }, { paymentDate: inRange }, { depositDate: inRange }] } }),
    stage({
      $addFields: {
        __lead: createdIn(from, to),
        __purchase: wrap(completedIn(whole, from, to)),
        __partial: wrap(partialIn(whole, from, to)),
        __collected: wrap(collectedIn(whole, from, to)),
      },
    }),
    stage({
      $lookup: {
        from: AcquisitionEvent.collection.name,
        let: { inscription: { $toString: '$_id' } },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$inscriptionId', '$$inscription'] }, { $eq: ['$name', 'lead'] }] } } },
          { $limit: 1 },
          { $project: { _id: 0, visitId: 1 } },
        ],
        as: '__leadEvent',
      },
    }),
    stage({ $lookup: { from: AcquisitionVisit.collection.name, localField: '__leadEvent.visitId', foreignField: 'visitId', as: 'visit' } }),
    stage({ $addFields: { visit: { $arrayElemAt: ['$visit', 0] } } }),
    ...(hasVisitFilters(filters) ? [stage({ $match: visitFilterMatch(filters, 'visit.') })] : []),
    ...attributionStages(filters.perspective, 'visit.'),
    ...attributedFilter(filters),
    stage({
      $group: {
        _id: { channel: '$attributedChannel', platform: '$attributedPlatform' },
        leads: { $sum: { $cond: ['$__lead', 1, 0] } },
        purchases: { $sum: { $cond: ['$__purchase', 1, 0] } },
        partialPayments: { $sum: { $cond: ['$__partial', 1, 0] } },
        revenue: { $sum: '$__collected' },
      },
    }),
    stage({ $project: { _id: 0, channel: '$_id.channel', platform: '$_id.platform', leads: 1, purchases: 1, partialPayments: 1, revenue: 1 } }),
  ];
};
