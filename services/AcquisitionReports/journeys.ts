import { Types } from 'mongoose';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';
import { stage, visitFilterMatch } from './attribution.js';
import { rangeInfo } from './envelope.js';
import type { JourneysQuery } from './filters.js';
import { collectedIn, inscriptionsLookup } from './payments.js';
import { resolveRange } from './range.js';
import type { ReportRange } from './range.js';
import { QUERY_OPTIONS } from './runners.js';
import { furthestStep } from './steps.js';
import type { JourneyDetailResponse, JourneyRow, JourneysResponse } from './types.js';

const EVENTS_PER_VISIT = 500;
const FOREVER = { from: new Date(0), to: new Date('2100-01-01T00:00:00.000Z') };

/** Everything collected so far by the inscriptions, whatever the date of each payment. */
const collectedEver = { $let: { vars: { i: '$$ROOT' }, in: collectedIn('$$i', FOREVER.from, FOREVER.to) } };

const journeyMatch = (range: ReportRange, filters: JourneysQuery): Record<string, unknown> => ({
  startedAt: { $gte: range.from, $lt: range.toExclusive },
  ...visitFilterMatch(filters),
  ...(filters.channel === undefined ? {} : { 'classification.channelGroup': filters.channel }),
  ...(filters.platform === undefined ? {} : { 'classification.sourcePlatform': filters.platform }),
});

interface JourneyAggregate {
  visitId: string;
  startedAt: Date;
  lastActivityAt: Date;
  channelGroup: string;
  sourcePlatform: string;
  device: string;
  eventNames: string[];
  revenue: number;
  landingSlug?: string;
}

/** The page is cut before any lookup, so the cost follows the page size and not the range. */
const pagePipeline = (match: Record<string, unknown>, skip: number, limit: number) => [
  stage({ $match: match }),
  stage({ $sort: { startedAt: -1, visitId: -1 } }),
  stage({ $skip: skip }),
  stage({ $limit: limit }),
  stage({
    $lookup: {
      from: AcquisitionEvent.collection.name,
      let: { visit: '$visitId' },
      pipeline: [
        { $match: { $expr: { $eq: ['$visitId', '$$visit'] } } },
        { $sort: { occurredAt: 1 } },
        { $limit: EVENTS_PER_VISIT },
        { $project: { _id: 0, name: 1, inscriptionId: 1 } },
      ],
      as: '__events',
    },
  }),
  stage({
    $addFields: {
      __inscriptionIds: {
        $map: {
          input: { $filter: { input: '$__events', as: 'event', cond: { $eq: ['$$event.name', 'lead'] } } },
          as: 'lead',
          in: { $convert: { input: '$$lead.inscriptionId', to: 'objectId', onError: null, onNull: null } },
        },
      },
    },
  }),
  inscriptionsLookup('__inscriptionIds', '__inscriptions'),
  stage({
    $project: {
      _id: 0,
      visitId: 1,
      startedAt: 1,
      lastActivityAt: 1,
      landingSlug: 1,
      device: 1,
      channelGroup: '$classification.channelGroup',
      sourcePlatform: '$classification.sourcePlatform',
      eventNames: '$__events.name',
      revenue: { $sum: { $map: { input: '$__inscriptions', as: 'i', in: collectedIn('$$i', FOREVER.from, FOREVER.to) } } },
    },
  }),
];

const toRow = (journey: JourneyAggregate): JourneyRow => ({
  visitId: journey.visitId,
  startedAt: journey.startedAt.toISOString(),
  lastActivityAt: journey.lastActivityAt.toISOString(),
  channelGroup: journey.channelGroup,
  sourcePlatform: journey.sourcePlatform,
  device: journey.device,
  maxStep: furthestStep(journey.eventNames),
  hasLead: journey.eventNames.includes('lead'),
  hasPurchase: journey.eventNames.includes('purchase'),
  revenue: journey.revenue,
  eventCount: journey.eventNames.length,
  truncated: journey.eventNames.length >= EVENTS_PER_VISIT,
  ...(journey.landingSlug === undefined ? {} : { landingSlug: journey.landingSlug }),
});

export const getJourneys = async (filters: JourneysQuery, now = new Date()): Promise<JourneysResponse> => {
  const range = resolveRange(filters);
  const match = journeyMatch(range, filters);
  const [rows, total] = await Promise.all([
    AcquisitionVisit.aggregate<JourneyAggregate>(pagePipeline(match, (filters.page - 1) * filters.limit, filters.limit)).option(QUERY_OPTIONS),
    AcquisitionVisit.countDocuments(match).maxTimeMS(QUERY_OPTIONS.maxTimeMS),
  ]);

  return {
    generatedAt: now.toISOString(),
    timezone: range.timezone,
    range: rangeInfo(filters, range),
    pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) },
    data: { journeys: rows.map(toRow) },
  };
};

/** Timeline of one visit: attribution, events in order and the conversions it produced. No personal data. */
export const getJourneyDetail = async (visitId: string, now = new Date()): Promise<JourneyDetailResponse | null> => {
  const visit = await AcquisitionVisit.findOne({ visitId }).maxTimeMS(QUERY_OPTIONS.maxTimeMS).lean();
  if (!visit) return null;

  const events = await AcquisitionEvent.find({ visitId })
    .sort({ occurredAt: 1, receivedAt: 1 })
    .limit(EVENTS_PER_VISIT)
    .select('name occurredAt source path courseId inscriptionId')
    .maxTimeMS(QUERY_OPTIONS.maxTimeMS)
    .lean();

  const inscriptionIds = events
    .filter((event) => event.name === 'lead' && event.inscriptionId && Types.ObjectId.isValid(event.inscriptionId))
    .map((event) => new Types.ObjectId(event.inscriptionId));
  // Most visits have no lead: skip the lookup entirely instead of scanning inscriptions for nothing.
  const conversions =
    inscriptionIds.length === 0
      ? []
      : await Inscription.aggregate<{ _id: { toString(): string }; paymentStatus: string; collected: number }>([
          stage({ $match: { _id: { $in: inscriptionIds } } }),
          stage({ $project: { paymentStatus: 1, collected: collectedEver } }),
          stage({ $sort: { _id: 1 } }),
        ]).option(QUERY_OPTIONS);

  return {
    generatedAt: now.toISOString(),
    data: {
      visit: {
        visitId: visit.visitId,
        startedAt: visit.startedAt.toISOString(),
        lastActivityAt: visit.lastActivityAt.toISOString(),
        entryPath: visit.entryPath,
        channelGroup: visit.classification.channelGroup,
        sourcePlatform: visit.classification.sourcePlatform,
        acquisitionType: visit.classification.acquisitionType,
        reason: visit.classification.reason,
        device: visit.device,
        hasFbc: visit.hasFbc,
        hasFbp: visit.hasFbp,
        // term and content are free text chosen by whoever tags the campaign: they are not exposed.
        rawAttribution: {
          ...(visit.rawAttribution?.source === undefined ? {} : { source: visit.rawAttribution.source }),
          ...(visit.rawAttribution?.medium === undefined ? {} : { medium: visit.rawAttribution.medium }),
          ...(visit.rawAttribution?.campaign === undefined ? {} : { campaign: visit.rawAttribution.campaign }),
        },
        ...(visit.landingSlug === undefined ? {} : { landingSlug: visit.landingSlug }),
        ...(visit.referrerHost === undefined ? {} : { referrerHost: visit.referrerHost }),
      },
      events: events.map((event) => ({
        name: event.name,
        occurredAt: event.occurredAt.toISOString(),
        source: event.source,
        ...(event.path === undefined ? {} : { path: event.path }),
        ...(event.courseId === undefined ? {} : { courseId: event.courseId }),
      })),
      conversions: conversions.map((row) => ({ inscriptionId: row._id.toString(), paymentStatus: row.paymentStatus, collected: row.collected })),
      truncated: events.length >= EVENTS_PER_VISIT,
    },
  };
};
