import type { PipelineStage } from 'mongoose';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';
import { stage } from './attribution.js';
import { rangeInfo, ratio } from './envelope.js';
import type { QualityQuery } from './filters.js';
import { collectedIn, completedIn } from './payments.js';
import { resolveRange } from './range.js';
import type { ReportRange } from './range.js';
import { QUERY_OPTIONS } from './runners.js';
import type { QualityData, QualityResponse, QualityRule, QualitySeverity } from './types.js';

/** Initial thresholds; deliberately plain constants, not benchmarks. */
export const QUALITY_THRESHOLDS = {
  unknownChannel: { warning: 0.2, critical: 0.5 },
  incompleteTagging: { warning: 0.1 },
  orphanEvents: { warning: 0.05 },
  inscriptionsWithoutVisit: { warning: 0.3 },
  staleAfterHours: 6,
  capiPendingHours: 24,
  futureToleranceMs: 5 * 60 * 1000,
};

const HOUR_MS = 60 * 60 * 1000;
const FOREVER = { from: new Date(0), to: new Date('2100-01-01T00:00:00.000Z') };
const PAID_REASONS = ['paid_medium', 'paid_campaign_mapped', 'paid_source_alias'];
const OPEN_CAPI_STATUSES = ['accepted', 'pending', 'retry'];

interface Measure {
  affected: number;
  universe: number;
  first: Date | null;
  last: Date | null;
}

type Row = Record<string, unknown>;

/** `$group` fields counting the documents that match `condition`, with their first and last date. */
const counter = (name: string, condition: unknown, dateField: string): Record<string, unknown> => ({
  [name]: { $sum: { $cond: [condition, 1, 0] } },
  [`${name}First`]: { $min: { $cond: [condition, dateField, '$$REMOVE'] } },
  [`${name}Last`]: { $max: { $cond: [condition, dateField, '$$REMOVE'] } },
});

const measure = (row: Row | undefined, name: string, universe: number | undefined = undefined): Measure => ({
  affected: Number(row?.[name] ?? 0),
  universe: universe ?? Number(row?.universe ?? 0),
  first: (row?.[`${name}First`] as Date | undefined) ?? null,
  last: (row?.[`${name}Last`] as Date | undefined) ?? null,
});


const missing = (field: string) => ({ $eq: [{ $ifNull: [field, ''] }, ''] });

const leadLookup = (name: 'lead' | 'purchase', as: string): PipelineStage =>
  stage({
    $lookup: {
      from: AcquisitionEvent.collection.name,
      let: { inscription: { $toString: '$_id' } },
      pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$inscriptionId', '$$inscription'] }, { $eq: ['$name', name] }] } } },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as,
    },
  });

const firstRow = async (model: { aggregate: (pipeline: PipelineStage[]) => { option: (o: object) => Promise<Row[]> } }, pipeline: PipelineStage[]) =>
  (await model.aggregate(pipeline).option(QUERY_OPTIONS))[0];

const visitsRow = (range: ReportRange) => {
  const paid = { $eq: ['$classification.acquisitionType', 'paid'] };
  return firstRow(AcquisitionVisit, [
    stage({ $match: { startedAt: { $gte: range.from, $lt: range.toExclusive } } }),
    stage({
      $group: {
        _id: null,
        universe: { $sum: 1 },
        paidVisits: { $sum: { $cond: [paid, 1, 0] } },
        withFbc: { $sum: { $cond: ['$hasFbc', 1, 0] } },
        withFbp: { $sum: { $cond: ['$hasFbp', 1, 0] } },
        ...counter('unknown', { $eq: ['$classification.channelGroup', 'unknown'] }, '$startedAt'),
        ...counter('utmWithoutMedium', { $and: [{ $not: [missing('$rawAttribution.source')] }, missing('$rawAttribution.medium')] }, '$startedAt'),
        ...counter('paidWithoutCampaign', { $and: [paid, missing('$rawAttribution.campaign')] }, '$startedAt'),
        ...counter('paidWithoutEvidence', { $and: [paid, { $not: [{ $in: ['$classification.reason', PAID_REASONS] }] }] }, '$startedAt'),
      },
    }),
  ]);
};

const eventsRow = (range: ReportRange) =>
  firstRow(AcquisitionEvent, [
    stage({ $match: { occurredAt: { $gte: range.from, $lt: range.toExclusive } } }),
    stage({ $lookup: { from: AcquisitionVisit.collection.name, localField: 'visitId', foreignField: 'visitId', as: '__visit' } }),
    stage({
      $group: {
        _id: null,
        universe: { $sum: 1 },
        ...counter('orphans', { $eq: [{ $size: '$__visit' }, 0] }, '$occurredAt'),
        ...counter('future', { $gt: ['$occurredAt', { $add: ['$receivedAt', QUALITY_THRESHOLDS.futureToleranceMs] }] }, '$occurredAt'),
      },
    }),
  ]);

const purchasesRow = (range: ReportRange) =>
  firstRow(AcquisitionEvent, [
    stage({ $match: { name: 'purchase', occurredAt: { $gte: range.from, $lt: range.toExclusive } } }),
    stage({ $addFields: { __oid: { $convert: { input: '$inscriptionId', to: 'objectId', onError: null, onNull: null } } } }),
    stage({ $lookup: { from: Inscription.collection.name, localField: '__oid', foreignField: '_id', as: '__inscription' } }),
    stage({
      $group: {
        _id: null,
        universe: { $sum: 1 },
        ...counter(
          'withoutPayment',
          {
            $or: [
              { $eq: [{ $size: '$__inscription' }, 0] },
              { $lte: [{ $sum: { $map: { input: '$__inscription', as: 'i', in: collectedIn('$$i', FOREVER.from, FOREVER.to) } } }, 0] },
            ],
          },
          '$occurredAt',
        ),
      },
    }),
  ]);

const inscriptionsWithoutVisitRow = (range: ReportRange) =>
  firstRow(Inscription, [
    stage({ $match: { metaMarketingConsent: true, fechaInscripcion: { $gte: range.from, $lt: range.toExclusive } } }),
    leadLookup('lead', '__lead'),
    stage({ $group: { _id: null, universe: { $sum: 1 }, ...counter('withoutVisit', { $eq: [{ $size: '$__lead' }, 0] }, '$fechaInscripcion') } }),
  ]);

/** Paid, consenting inscriptions whose journey is linked (has a lead) but whose purchase signal is missing. */
const paymentsWithoutSignalRow = (range: ReportRange) =>
  firstRow(Inscription, [
    stage({
      $match: {
        metaMarketingConsent: true,
        paymentStatus: 'paid',
        $expr: { $let: { vars: { i: '$$ROOT' }, in: completedIn('$$i', range.from, range.toExclusive) } },
      },
    }),
    leadLookup('lead', '__lead'),
    leadLookup('purchase', '__purchase'),
    stage({ $match: { $expr: { $gt: [{ $size: '$__lead' }, 0] } } }),
    stage({ $group: { _id: null, universe: { $sum: 1 }, ...counter('missingSignal', { $eq: [{ $size: '$__purchase' }, 0] }, '$fechaInscripcion') } }),
  ]);

const attemptsRow = (range: ReportRange, now: Date) => {
  const cutoff = new Date(now.getTime() - QUALITY_THRESHOLDS.capiPendingHours * HOUR_MS);
  const status = (value: string) => ({ $sum: { $cond: [{ $eq: ['$status', value] }, 1, 0] } });
  return firstRow(AcquisitionSignalAttempt, [
    stage({ $match: { channel: 'server_capi', occurredAt: { $gte: range.from, $lt: range.toExclusive } } }),
    stage({
      $group: {
        _id: null,
        universe: { $sum: 1 },
        accepted: status('accepted'),
        delivered: status('delivered'),
        pending: status('pending'),
        retry: status('retry'),
        exhausted: status('exhausted'),
        ...counter('tooLong', { $and: [{ $in: ['$status', OPEN_CAPI_STATUSES] }, { $lt: ['$updatedAt', cutoff] }] }, '$occurredAt'),
        ...counter('dead', { $eq: ['$status', 'exhausted'] }, '$occurredAt'),
      },
    }),
  ]);
};

const lastActivity = async (): Promise<Date | null> => {
  const [event, visit] = await Promise.all([
    AcquisitionEvent.findOne().sort({ receivedAt: -1 }).select('receivedAt').maxTimeMS(QUERY_OPTIONS.maxTimeMS).lean(),
    AcquisitionVisit.findOne().sort({ startedAt: -1 }).select('startedAt').maxTimeMS(QUERY_OPTIONS.maxTimeMS).lean(),
  ]);
  const times = [event?.receivedAt, visit?.startedAt].filter((time): time is Date => time !== undefined);
  return times.length === 0 ? null : new Date(Math.max(...times.map((time) => time.getTime())));
};

interface RuleSpec {
  code: string;
  measure: Measure;
  severity: (affected: number, percentage: number | null) => QualitySeverity | undefined;
  explanation: string;
  action: string;
}

const tiers = (warning: number, critical?: number) => (_affected: number, percentage: number | null): QualitySeverity | undefined => {
  if (critical !== undefined && (percentage ?? 0) >= critical) return 'critical';
  return (percentage ?? 0) >= warning ? 'warning' : undefined;
};
const infoUntil = (warning: number) => (affected: number, percentage: number | null): QualitySeverity | undefined =>
  affected === 0 ? undefined : (percentage ?? 0) >= warning ? 'warning' : 'info';
const always = (severity: QualitySeverity) => (affected: number): QualitySeverity | undefined => (affected > 0 ? severity : undefined);

const toRule = (spec: RuleSpec): QualityRule | undefined => {
  const percentage = ratio(spec.measure.affected, spec.measure.universe);
  const severity = spec.measure.affected > 0 ? spec.severity(spec.measure.affected, percentage) : undefined;
  return severity === undefined
    ? undefined
    : {
        code: spec.code,
        severity,
        affected: spec.measure.affected,
        universe: spec.measure.universe,
        percentage,
        firstOccurrence: spec.measure.first?.toISOString() ?? null,
        lastOccurrence: spec.measure.last?.toISOString() ?? null,
        explanation: spec.explanation,
        action: spec.action,
      };
};

export const getQualityReport = async (filters: QualityQuery, now = new Date()): Promise<QualityResponse> => {
  const range = resolveRange(filters);
  const [visits, events, purchases, withoutVisit, withoutSignal, attempts, last] = await Promise.all([
    visitsRow(range), eventsRow(range), purchasesRow(range), inscriptionsWithoutVisitRow(range), paymentsWithoutSignalRow(range), attemptsRow(range, now), lastActivity(),
  ]);

  const t = QUALITY_THRESHOLDS;
  const paidUniverse = Number(visits?.paidVisits ?? 0);
  const specs: RuleSpec[] = [
    { code: 'UNKNOWN_CHANNEL_RATE_HIGH', measure: measure(visits, 'unknown'), severity: tiers(t.unknownChannel.warning, t.unknownChannel.critical),
      explanation: 'Una parte alta de las visitas no se pudo clasificar en ningún canal.', action: 'Revisá las UTMs de las campañas activas y el convenio de nombres; filtrá recorridos por canal unknown.' },
    { code: 'UTM_SOURCE_WITHOUT_MEDIUM', measure: measure(visits, 'utmWithoutMedium'), severity: infoUntil(t.incompleteTagging.warning),
      explanation: 'Hay visitas con utm_source pero sin utm_medium, así que no se puede distinguir pago de orgánico.', action: 'Agregá utm_medium a los enlaces (cpc, paid_social, social, email).' },
    { code: 'PAID_MEDIUM_WITHOUT_CAMPAIGN', measure: measure(visits, 'paidWithoutCampaign', paidUniverse), severity: infoUntil(t.incompleteTagging.warning),
      explanation: 'Hay visitas pagas sin utm_campaign, lo que impide medir por campaña.', action: 'Agregá utm_campaign a los anuncios pagos.' },
    { code: 'SOCIAL_SOURCE_CLASSIFIED_AS_PAID_WITHOUT_EVIDENCE', measure: measure(visits, 'paidWithoutEvidence', paidUniverse), severity: always('critical'),
      explanation: 'Hay visitas clasificadas como pagas sin un medio pago, una campaña mapeada ni un alias de anuncio.', action: 'Revisá el clasificador: no debe inferir pago solo por la red de origen.' },
    { code: 'ORPHAN_EVENT', measure: measure(events, 'orphans'), severity: infoUntil(t.orphanEvents.warning),
      explanation: 'Hay eventos cuya visita no existe (llegaron antes que la visita o su registro falló).', action: 'Si crece, revisá el orden de envío del cliente y los errores de /visits.' },
    { code: 'EVENT_TIME_IN_FUTURE', measure: measure(events, 'future'), severity: always('warning'),
      explanation: 'Hay eventos con la hora del navegador adelantada respecto de la recepción.', action: 'Sospechá de relojes desfasados o de clientes que no son el sitio.' },
    { code: 'PURCHASE_WITHOUT_PAYMENT', measure: measure(purchases, 'withoutPayment'), severity: always('critical'),
      explanation: 'Hay señales de compra sin dinero cobrado detrás.', action: 'Compará esas inscripciones con los pagos reales antes de confiar en las campañas.' },
    { code: 'PAYMENT_WITHOUT_PURCHASE_SIGNAL', measure: measure(withoutSignal, 'missingSignal'), severity: always('warning'),
      explanation: 'Hay inscripciones pagadas con recorrido que no generaron la señal de compra.', action: 'Revisá que el pago pase por fireMetaEvent y que el flag esté activo.' },
    { code: 'INSCRIPTION_WITHOUT_VISIT', measure: measure(withoutVisit, 'withoutVisit'), severity: tiers(t.inscriptionsWithoutVisit.warning),
      explanation: 'Hay inscripciones con consentimiento que no se pudieron vincular a una visita.', action: 'Verificá que la web envíe /visits antes del formulario y que el visitante coincida.' },
    { code: 'CAPI_PENDING_TOO_LONG', measure: measure(attempts, 'tooLong'), severity: always('warning'),
      explanation: `Hay eventos CAPI sin resolver hace más de ${t.capiPendingHours} horas.`, action: 'Revisá el cron de la DLQ de Meta y las credenciales.' },
    { code: 'CAPI_EXHAUSTED', measure: measure(attempts, 'dead'), severity: always('critical'),
      explanation: 'Hay eventos CAPI que agotaron sus reintentos y no llegaron a Meta.', action: 'Inspeccioná la DLQ y reenviá o descartá según corresponda.' },
  ];

  const stale = last === null || now.getTime() - last.getTime() > t.staleAfterHours * HOUR_MS;
  const staleRule: QualityRule | undefined = stale
    ? {
        code: 'TRACKING_STALE', severity: 'warning', affected: 1, universe: 1, percentage: 1,
        firstOccurrence: null, lastOccurrence: last?.toISOString() ?? null,
        explanation: `No llegan visitas ni eventos hace más de ${t.staleAfterHours} horas.`, action: 'Verificá que el flag esté activo, que la web envíe datos y que la API responda.',
      }
    : undefined;

  const withFbc = Number(visits?.withFbc ?? 0);
  const withFbp = Number(visits?.withFbp ?? 0);
  const total = Number(visits?.universe ?? 0);
  const data: QualityData = {
    rules: [...specs.map(toRule), staleRule].filter((rule): rule is QualityRule => rule !== undefined),
    evaluated: [...specs.map((spec) => spec.code), 'TRACKING_STALE'],
    capi: {
      accepted: Number(attempts?.accepted ?? 0), delivered: Number(attempts?.delivered ?? 0), pending: Number(attempts?.pending ?? 0),
      retry: Number(attempts?.retry ?? 0), exhausted: Number(attempts?.exhausted ?? 0),
    },
    identifiers: { visits: total, withFbc, withFbp, fbcCoverage: ratio(withFbc, total), fbpCoverage: ratio(withFbp, total) },
    tracking: { lastActivityAt: last?.toISOString() ?? null, stale },
  };
  return { generatedAt: now.toISOString(), timezone: range.timezone, range: rangeInfo(filters, range), data };
};

