import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { stage } from './attribution.js';
import type { LiveQuery } from './filters.js';
import { QUERY_OPTIONS } from './runners.js';
import type { LiveData, LiveResponse } from './types.js';

const MINUTE_MS = 60_000;
const RECENT_EVENTS = 20;
const SHORT_ID_LENGTH = 8;

const minuteOf = (instant: number): number => Math.floor(instant / MINUTE_MS) * MINUTE_MS;

/**
 * Activity by server time (`updatedAt` / `receivedAt`), not by client timestamps. Visit ids are
 * shortened and visitor ids never leave the server.
 */
export const getLiveReport = async ({ windowMinutes }: LiveQuery, now = new Date()): Promise<LiveResponse> => {
  const since = new Date(now.getTime() - windowMinutes * MINUTE_MS);
  const received = { receivedAt: { $gte: since, $lte: now } };

  const [activeByChannel, perMinute, recent] = await Promise.all([
    AcquisitionVisit.aggregate<{ _id: string; count: number }>([
      stage({ $match: { updatedAt: { $gte: since, $lte: now } } }),
      stage({ $group: { _id: '$classification.channelGroup', count: { $sum: 1 } } }),
    ]).option(QUERY_OPTIONS),
    AcquisitionEvent.aggregate<{ _id: Date; count: number }>([
      stage({ $match: received }),
      stage({ $group: { _id: { $dateTrunc: { date: '$receivedAt', unit: 'minute' } }, count: { $sum: 1 } } }),
    ]).option(QUERY_OPTIONS),
    AcquisitionEvent.aggregate<{ name: string; receivedAt: Date; visitId: string; path?: string; courseId?: string; channel?: string[] }>([
      stage({ $match: received }),
      stage({ $sort: { receivedAt: -1 } }),
      stage({ $limit: RECENT_EVENTS }),
      stage({ $lookup: { from: AcquisitionVisit.collection.name, localField: 'visitId', foreignField: 'visitId', as: 'visit' } }),
      stage({ $project: { _id: 0, name: 1, receivedAt: 1, visitId: 1, path: 1, courseId: 1, channel: '$visit.classification.channelGroup' } }),
    ]).option(QUERY_OPTIONS),
  ]);

  const counts = new Map(perMinute.map((row) => [row._id.getTime(), row.count]));
  const eventsPerMinute: LiveData['eventsPerMinute'] = [];
  for (let minute = minuteOf(since.getTime()); minute <= minuteOf(now.getTime()); minute += MINUTE_MS) {
    eventsPerMinute.push({ minute: new Date(minute).toISOString(), count: counts.get(minute) ?? 0 });
  }

  const data: LiveData = {
    activeVisits: activeByChannel.reduce((sum, row) => sum + row.count, 0),
    eventsInWindow: perMinute.reduce((sum, row) => sum + row.count, 0),
    activeByChannel: activeByChannel
      .map((row) => ({ channelGroup: row._id, count: row.count }))
      .sort((a, b) => b.count - a.count || a.channelGroup.localeCompare(b.channelGroup)),
    eventsPerMinute,
    recentEvents: recent.map((event) => ({
      name: event.name,
      at: event.receivedAt.toISOString(),
      visit: event.visitId.slice(0, SHORT_ID_LENGTH),
      channelGroup: event.channel?.[0] ?? null,
      ...(event.path === undefined ? {} : { path: event.path }),
      ...(event.courseId === undefined ? {} : { courseId: event.courseId }),
    })),
  };
  return { generatedAt: now.toISOString(), windowMinutes, data };
};
