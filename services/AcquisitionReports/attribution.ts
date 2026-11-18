import type { PipelineStage } from 'mongoose';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import type { ReportQuery } from './filters.js';
import type { ReportRange } from './range.js';
import type { Perspective } from './types.js';

/** Aggregation stages are built from plain objects; one cast here keeps the builders readable. */
export const stage = (value: Record<string, unknown>): PipelineStage => value as unknown as PipelineStage;

/** Channels that say nothing about where the person came from. */
const NOT_A_REAL_ORIGIN = ['direct', 'unknown'];

const VISIT_FILTER_FIELDS: ReadonlyArray<readonly [keyof ReportQuery, string]> = [
  ['campaign', 'rawAttribution.campaign'],
  ['source', 'rawAttribution.source'],
  ['medium', 'rawAttribution.medium'],
  ['landing', 'landingSlug'],
  ['device', 'device'],
];

export const hasVisitFilters = (filters: ReportQuery): boolean =>
  filters.channel !== undefined || filters.platform !== undefined || VISIT_FILTER_FIELDS.some(([key]) => filters[key] !== undefined);

/** `$match` on the properties of a visit; `prefix` is where the visit lives in the document ('' or 'visit.'). */
export const visitFilterMatch = (filters: ReportQuery, prefix = ''): Record<string, string> =>
  Object.fromEntries(VISIT_FILTER_FIELDS.flatMap(([key, path]) => (filters[key] === undefined ? [] : [[`${prefix}${path}`, filters[key] as string]])));

export const visitsInRange = (range: ReportRange, filters: ReportQuery): PipelineStage =>
  stage({ $match: { startedAt: { $gte: range.from, $lt: range.toExclusive }, ...visitFilterMatch(filters) } });

/** Channel/platform filters apply to the attributed values, so they depend on the perspective. */
export const attributedFilter = (filters: ReportQuery): PipelineStage[] => {
  const match = {
    ...(filters.channel === undefined ? {} : { attributedChannel: filters.channel }),
    ...(filters.platform === undefined ? {} : { attributedPlatform: filters.platform }),
  };
  return Object.keys(match).length === 0 ? [] : [stage({ $match: match })];
};

/**
 * Adds `attributedChannel` / `attributedPlatform` to documents that carry a visit under `prefix`.
 * The perspective only changes which visit's origin a visit is credited to; conversions inherit
 * the value of the visit they happened in, so every number of a row is on the same footing.
 * Documents without a visit end up as `unlinked`.
 */
export const attributionStages = (perspective: Perspective, prefix: string): PipelineStage[] => {
  const ownChannel = `$${prefix}classification.channelGroup`;
  const ownPlatform = `$${prefix}classification.sourcePlatform`;
  if (perspective === 'visit_touch') {
    return [stage({ $addFields: { attributedChannel: { $ifNull: [ownChannel, 'unlinked'] }, attributedPlatform: { $ifNull: [ownPlatform, 'unknown'] } } })];
  }

  const direction = perspective === 'first_touch' ? 1 : -1;
  const conditions =
    perspective === 'first_touch'
      ? [{ $ne: ['$classification.channelGroup', 'unknown'] }]
      : [{ $lte: ['$startedAt', '$$started'] }, { $not: [{ $in: ['$classification.channelGroup', NOT_A_REAL_ORIGIN] }] }];

  return [
    stage({
      $lookup: {
        from: AcquisitionVisit.collection.name,
        let: { visitor: `$${prefix}visitorId`, started: `$${prefix}startedAt` },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$visitorId', '$$visitor'] }, ...conditions] } } },
          // visitId breaks ties between visits that started at the same instant.
          { $sort: { startedAt: direction, visitId: direction } },
          { $limit: 1 },
          { $project: { _id: 0, channel: '$classification.channelGroup', platform: '$classification.sourcePlatform' } },
        ],
        as: '__touch',
      },
    }),
    stage({
      $addFields: {
        attributedChannel: { $ifNull: [{ $arrayElemAt: ['$__touch.channel', 0] }, ownChannel, 'unlinked'] },
        attributedPlatform: { $ifNull: [{ $arrayElemAt: ['$__touch.platform', 0] }, ownPlatform, 'unknown'] },
      },
    }),
    stage({ $project: { __touch: 0 } }),
  ];
};
