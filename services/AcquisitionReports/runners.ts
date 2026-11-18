import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';
import type { ReportQuery } from './filters.js';
import { periodOutcomePipeline, visitPipeline } from './pipelines.js';
import type { ReportRange } from './range.js';
import type { Outcomes, RawChannelRow, VisitPipelineResult } from './types.js';

const QUERY_TIMEOUT_MS = 20_000;
export const QUERY_OPTIONS = { maxTimeMS: QUERY_TIMEOUT_MS, allowDiskUse: true };

export const runVisitPipeline = async (range: ReportRange, filters: ReportQuery, windowMs: number | undefined): Promise<VisitPipelineResult> => {
  const [result] = await AcquisitionVisit.aggregate<{ rows: RawChannelRow[]; distinct: Array<{ count: number }> }>(
    visitPipeline(range, filters, windowMs),
  ).option(QUERY_OPTIONS);
  return { rows: result?.rows ?? [], distinctVisitors: result?.distinct[0]?.count ?? 0 };
};

export const runPeriodPipeline = (range: ReportRange, filters: ReportQuery) =>
  Inscription.aggregate<Outcomes & { channel: string; platform: string }>(periodOutcomePipeline(range, filters)).option(QUERY_OPTIONS);
