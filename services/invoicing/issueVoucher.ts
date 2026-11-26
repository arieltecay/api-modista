import type { HydratedDocument, Model } from 'mongoose';
import { logger } from '../logger.js';
import { argentinaDay } from './dates.js';
import { ArcaRejectedError, ArcaUnavailableError } from './errors.js';
import { buildFiscalQrUrl } from './fiscalQr.js';
import type { ArcaInvoiceRecord, CreditedInvoice, IssueInvoiceDeps, VoucherFields, VoucherKind, VoucherResult } from './types.js';

type VoucherDoc = HydratedDocument<VoucherFields>;

/** What is being issued and where it is stored. */
export interface VoucherSpec {
  kind: VoucherKind;
  /** Spanish name used in the logs. */
  label: string;
  /** Key of the document id in the logs. */
  idKey: string;
  model: Model<VoucherFields>;
  /** Only for credit notes. */
  credits?: CreditedInvoice;
}

const LEASE_MS = 60_000;
const MAX_NUMBER_CONFLICTS = 3;
/** ARCA code for "invalid receipt number": somebody else already used it. */
const NUMBER_CONFLICT_CODE = '10016';
const DUPLICATE_KEY_CODE = 11000;
/** For services ARCA accepts an issue date within 10 days; past 5 the voucher is dated today instead. */
const STALE_ISSUE_DATE_MS = 5 * 24 * 3_600_000;

export const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === DUPLICATE_KEY_CODE;

const toResult = (voucher: VoucherDoc, issued: boolean): VoucherResult => ({ id: String(voucher._id), status: voucher.status, issued });

/** Another worker took over this voucher: this one must stop without writing. */
class LeaseLostError extends Error {}

type VoucherChange = Parameters<Model<VoucherFields>['findOneAndUpdate']>[1];

/** Writes only while this worker's claim is the last one (every claim increments `attempts`). */
const update = async (spec: VoucherSpec, voucher: VoucherDoc, change: VoucherChange): Promise<VoucherDoc> => {
  const held = { _id: voucher._id, status: 'pending' as const, attempts: voucher.attempts };
  const updated = await spec.model.findOneAndUpdate(held, change, { new: true });
  if (!updated) throw new LeaseLostError();
  return updated;
};

/** Keeps the lease alive before each slow call that can create a voucher in ARCA. */
const renewLease = (spec: VoucherSpec, voucher: VoucherDoc, clock: () => Date): Promise<VoucherDoc> =>
  update(spec, voucher, { $set: { lockedUntil: new Date(clock().getTime() + LEASE_MS) } });

/** A voucher that waited too long for ARCA (it was down) gets today's date, or ARCA would refuse the old one. */
const refreshStaleIssueDate = async (spec: VoucherSpec, voucher: VoucherDoc, now: Date): Promise<VoucherDoc> => {
  if (now.getTime() - voucher.issuedAt.getTime() <= STALE_ISSUE_DATE_MS) return voucher;
  return update(spec, voucher, { $set: { issuedAt: now } });
};

/** Takes the lease only if nobody holds a live one; returns null when another worker is on it. */
const claim = (spec: VoucherSpec, voucher: VoucherDoc, now: Date): Promise<VoucherDoc | null> =>
  spec.model.findOneAndUpdate(
    { _id: voucher._id, status: 'pending', $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true }
  );

const clearNumber = (spec: VoucherSpec, voucher: VoucherDoc): Promise<VoucherDoc> => update(spec, voucher, { $unset: { number: 1 } });

const reserveNumber = async (spec: VoucherSpec, voucher: VoucherDoc, deps: IssueInvoiceDeps): Promise<VoucherDoc> => {
  const number = (await deps.client.lastAuthorized(spec.kind)) + 1;
  return update(spec, voucher, { $set: { number } });
};

const numberTakenByAnother = async (spec: VoucherSpec, voucher: VoucherDoc, number: number): Promise<boolean> =>
  Boolean(
    await spec.model.exists({
      _id: { $ne: voucher._id },
      environment: voucher.environment,
      pointOfSale: voucher.pointOfSale,
      number,
      status: 'authorized',
    })
  );

/** Stores the CAE; null when the unique (environment, point of sale, number) index says it is taken. */
const authorize = async (
  spec: VoucherSpec,
  voucher: VoucherDoc,
  record: { number: number; cae: string; caeExpiresAt: string },
  deps: IssueInvoiceDeps
): Promise<VoucherDoc | null> => {
  const fiscalQrUrl = buildFiscalQrUrl({
    cuit: deps.config.cuit,
    pointOfSale: voucher.pointOfSale,
    number: record.number,
    total: voucher.total,
    issueDate: voucher.issuedAt,
    cae: record.cae,
    kind: spec.kind,
  });
  try {
    return await update(spec, voucher, {
      $set: { status: 'authorized', number: record.number, cae: record.cae, caeExpiresAt: record.caeExpiresAt, fiscalQrUrl, lockedUntil: null },
      $unset: { lastError: 1 },
    });
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
};

/** A stored credit note that cancels another invoice is certainly not ours: our request never took that number. */
const creditsAnother = (spec: VoucherSpec, record: ArcaInvoiceRecord): boolean =>
  Boolean(
    spec.credits &&
      record.credits &&
      (record.credits.number !== spec.credits.number || record.credits.pointOfSale !== spec.credits.pointOfSale)
  );

/** Same amount, day and (in credit notes) credited invoice. */
const isOurs = (spec: VoucherSpec, voucher: VoucherDoc, record: ArcaInvoiceRecord): boolean =>
  !creditsAnother(spec, record) &&
  (!spec.credits || Boolean(record.credits)) &&
  record.total === voucher.total &&
  record.issueDate === argentinaDay(voucher.issuedAt);

/** ARCA already has this number: adopt it only if it is ours, never someone else's. */
const adoptStored = (spec: VoucherSpec, voucher: VoucherDoc, record: ArcaInvoiceRecord): void => {
  if (isOurs(spec, voucher, record)) return;
  throw new ArcaRejectedError(
    `Conciliación manual requerida: ARCA tiene el comprobante ${record.number} con otros datos (total ${record.total}, fecha ${record.issueDate})`,
    []
  );
};

/**
 * After a 10016. An earlier request of ours may have finished late, so ARCA is asked who holds the number before
 * taking another one (or the voucher would be issued twice). 10016 also means "date before the last voucher".
 */
const resolveConflict = async (
  spec: VoucherSpec,
  voucher: VoucherDoc,
  number: number,
  deps: IssueInvoiceDeps,
  now: Date
): Promise<{ authorized?: VoucherDoc; next: VoucherDoc }> => {
  if (!(await numberTakenByAnother(spec, voucher, number))) {
    const stored = await deps.client.consult(number, spec.kind);
    if (stored && isOurs(spec, voucher, stored)) {
      const authorized = await authorize(spec, voucher, stored, deps);
      if (authorized) return { authorized, next: authorized };
    } else if (stored && spec.credits && !creditsAnother(spec, stored)) {
      // It credits our invoice with other data, or ARCA does not say what it credits: it could be ours.
      adoptStored(spec, voucher, stored);
    }
  }
  const cleared = await clearNumber(spec, voucher);
  const isOld = argentinaDay(cleared.issuedAt) < argentinaDay(now);
  return { next: isOld ? await update(spec, cleared, { $set: { issuedAt: now } }) : cleared };
};

const obtainCae = async (spec: VoucherSpec, start: VoucherDoc, deps: IssueInvoiceDeps): Promise<VoucherDoc> => {
  let voucher = start;
  const clock = deps.now ?? (() => new Date());
  for (let conflicts = 0; ; conflicts += 1) {
    let number = voucher.number;

    if (number == null) {
      voucher = await reserveNumber(spec, voucher, deps);
      number = voucher.number as number;
    } else if (await numberTakenByAnother(spec, voucher, number)) {
      voucher = await clearNumber(spec, voucher);
      continue;
    } else {
      const stored = await deps.client.consult(number, spec.kind);
      if (stored && creditsAnother(spec, stored)) {
        voucher = await clearNumber(spec, voucher);
        continue;
      }
      if (stored) {
        adoptStored(spec, voucher, stored);
        const adopted = await authorize(spec, voucher, stored, deps);
        if (adopted) return adopted;
        voucher = await clearNumber(spec, voucher);
        continue;
      }
    }

    // Only now: if ARCA already had this number we adopted it above, with its original date.
    voucher = await refreshStaleIssueDate(spec, await renewLease(spec, voucher, clock), clock());

    try {
      const result = await deps.client.requestCae({ number, total: voucher.total, issueDate: voucher.issuedAt, ...(spec.credits ? { credits: spec.credits } : {}) });
      const authorized = await authorize(spec, voucher, result, deps);
      if (authorized) return authorized;
      voucher = await clearNumber(spec, voucher);
    } catch (error) {
      const numberConflict = error instanceof ArcaRejectedError && error.codes.includes(NUMBER_CONFLICT_CODE);
      if (!numberConflict || conflicts >= MAX_NUMBER_CONFLICTS) throw error;
      const { authorized, next } = await resolveConflict(spec, voucher, number, deps, clock());
      if (authorized) return authorized;
      voucher = next;
    }
  }
};

/** Leaves the voucher in `status`, releases the lease and keeps any reserved number for the next attempt. */
const close = async (spec: VoucherSpec, voucher: VoucherDoc, status: 'pending' | 'failed', message: string): Promise<VoucherResult> => {
  // `attempts` identifies this worker's claim: the lease may have been renewed since.
  const closed = await spec.model.findOneAndUpdate(
    { _id: voucher._id, status: 'pending', attempts: voucher.attempts },
    { $set: { status, lastError: message, lockedUntil: null } },
    { new: true }
  );
  if (!closed) return toResult((await spec.model.findById(voucher._id)) ?? voucher, false);
  const context = { [spec.idKey]: String(voucher._id), environment: voucher.environment, number: closed.number, reason: message };
  if (status === 'failed') logger.error(`[Invoicing] ${spec.label} rechazada por ARCA`, context);
  else logger.warn(`[Invoicing] ${spec.label} queda pendiente: ARCA no respondió`, context);
  return toResult(closed, false);
};

/**
 * Issues (or finishes issuing) a stored voucher. Safe to call repeatedly and concurrently:
 * - a lease keeps two workers from asking ARCA for the same voucher;
 * - the number is stored before asking ARCA, so a lost answer is reconciled instead of duplicated.
 * Never throws for ARCA problems: unreachable stays `pending` (retry later), refused becomes `failed`.
 */
export const issueVoucher = async (id: string, spec: VoucherSpec, deps: IssueInvoiceDeps): Promise<VoucherResult> => {
  const now = (deps.now ?? (() => new Date()))();
  const voucher = await spec.model.findById(id).orFail();
  if (voucher.status !== 'pending') return toResult(voucher, false);
  if (voucher.environment !== deps.config.environment) {
    // Never send another environment's voucher to this environment's ARCA (shared database, preview vs production).
    logger.warn(`[Invoicing] ${spec.label} de otro entorno, se omite`, { [spec.idKey]: id, environment: voucher.environment });
    return toResult(voucher, false);
  }

  const claimed = await claim(spec, voucher, now);
  if (!claimed) return toResult((await spec.model.findById(id)) ?? voucher, false);

  try {
    const issued = await obtainCae(spec, claimed, deps);
    // Only fiscal identifiers: no name, email or amount of the receiver.
    logger.info(`[Invoicing] ${spec.label} autorizada`, {
      [spec.idKey]: id,
      environment: issued.environment,
      pointOfSale: issued.pointOfSale,
      number: issued.number,
      cae: issued.cae,
    });
    return toResult(issued, true);
  } catch (error) {
    if (error instanceof LeaseLostError) {
      logger.warn(`[Invoicing] ${spec.label}: otro proceso la tomó, se abandona`, { [spec.idKey]: id });
      return toResult((await spec.model.findById(id)) ?? claimed, false);
    }
    if (error instanceof ArcaRejectedError) return close(spec, claimed, 'failed', error.message);
    if (error instanceof ArcaUnavailableError) return close(spec, claimed, 'pending', error.message);
    await spec.model.updateOne({ _id: claimed._id, attempts: claimed.attempts }, { $set: { lockedUntil: null } });
    throw error;
  }
};
