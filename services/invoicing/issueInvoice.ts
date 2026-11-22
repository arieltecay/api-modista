import crypto from 'node:crypto';
import Invoice from '../../models/Invoice/index.js';
import { logger } from '../logger.js';
import { argentinaDay } from './dates.js';
import { ArcaRejectedError, ArcaUnavailableError } from './errors.js';
import { buildFiscalQrUrl } from './fiscalQr.js';
import { roundMoney } from './money.js';
import type { ArcaInvoiceRecord, IssueInvoiceDeps, IssueInvoiceInput, IssueInvoiceResult } from './types.js';

type InvoiceDoc = InstanceType<typeof Invoice>;

const LEASE_MS = 60_000;
const MAX_NUMBER_CONFLICTS = 3;
/** ARCA code for "invalid receipt number": somebody else already used it. */
const NUMBER_CONFLICT_CODE = '10016';
const DUPLICATE_KEY_CODE = 11000;
/** For services ARCA accepts an issue date within 10 days; past 5 the invoice is dated today instead. */
const STALE_ISSUE_DATE_MS = 5 * 24 * 3_600_000;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === DUPLICATE_KEY_CODE;

const toResult = (invoice: InvoiceDoc, issued: boolean): IssueInvoiceResult => ({
  invoiceId: String(invoice._id),
  status: invoice.status,
  issued,
});

const findOrCreate = async (input: IssueInvoiceInput, deps: IssueInvoiceDeps, issuedAt: Date): Promise<InvoiceDoc> => {
  const existing = await Invoice.findOne({ inscriptionId: input.inscriptionId });
  if (existing) return existing;
  const total = roundMoney(input.total);
  try {
    return await Invoice.create({
      inscriptionId: input.inscriptionId,
      mpPaymentId: input.mpPaymentId,
      environment: deps.config.environment,
      pointOfSale: deps.config.pointOfSale,
      issuedAt,
      total,
      lines: [{ description: input.description, quantity: 1, unitPrice: total }],
      receiver: { name: input.receiverName, email: input.receiverEmail },
      emitter: deps.emitter,
      publicToken: crypto.randomBytes(32).toString('hex'),
    });
  } catch (error) {
    const raced = isDuplicateKey(error) ? await Invoice.findOne({ inscriptionId: input.inscriptionId }) : null;
    if (raced) return raced;
    throw error;
  }
};

/** An invoice that waited too long for ARCA (it was down) gets today's date, or ARCA would refuse the old one. */
const refreshStaleIssueDate = async (invoice: InvoiceDoc, now: Date): Promise<InvoiceDoc> => {
  if (now.getTime() - invoice.issuedAt.getTime() <= STALE_ISSUE_DATE_MS) return invoice;
  return (await Invoice.findByIdAndUpdate(invoice._id, { $set: { issuedAt: now } }, { new: true })) ?? invoice;
};

/** Takes the lease only if nobody holds a live one; returns null when another worker is on it. */
const claim = (invoice: InvoiceDoc, now: Date): Promise<InvoiceDoc | null> =>
  Invoice.findOneAndUpdate(
    { _id: invoice._id, status: 'pending', $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true }
  );

const clearNumber = async (invoice: InvoiceDoc): Promise<InvoiceDoc> =>
  (await Invoice.findByIdAndUpdate(invoice._id, { $unset: { number: 1 } }, { new: true })) ?? invoice;

const reserveNumber = async (invoice: InvoiceDoc, deps: IssueInvoiceDeps): Promise<InvoiceDoc> => {
  const number = (await deps.client.lastAuthorized()) + 1;
  return (await Invoice.findByIdAndUpdate(invoice._id, { $set: { number } }, { new: true })) ?? invoice;
};

const numberTakenByAnother = async (invoice: InvoiceDoc, number: number): Promise<boolean> =>
  Boolean(
    await Invoice.exists({
      _id: { $ne: invoice._id },
      environment: invoice.environment,
      pointOfSale: invoice.pointOfSale,
      number,
      status: 'authorized',
    })
  );

/** Stores the CAE; null when the unique (environment, point of sale, number) index says it is taken. */
const authorize = async (
  invoice: InvoiceDoc,
  record: { number: number; cae: string; caeExpiresAt: string },
  deps: IssueInvoiceDeps
): Promise<InvoiceDoc | null> => {
  const fiscalQrUrl = buildFiscalQrUrl({
    cuit: deps.config.cuit,
    pointOfSale: invoice.pointOfSale,
    number: record.number,
    total: invoice.total,
    issueDate: invoice.issuedAt,
    cae: record.cae,
  });
  try {
    return await Invoice.findByIdAndUpdate(
      invoice._id,
      {
        $set: { status: 'authorized', number: record.number, cae: record.cae, caeExpiresAt: record.caeExpiresAt, fiscalQrUrl, lockedUntil: null },
        $unset: { lastError: 1 },
      },
      { new: true }
    );
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
};

/** ARCA already has this number: adopt it only if it is our invoice (same amount and day), never someone else's. */
const adoptStored = (invoice: InvoiceDoc, record: ArcaInvoiceRecord): void => {
  const sameInvoice = record.total === invoice.total && record.issueDate === argentinaDay(invoice.issuedAt);
  if (!sameInvoice) {
    throw new ArcaRejectedError(
      `Conciliación manual requerida: ARCA tiene el comprobante ${record.number} con otros datos (total ${record.total}, fecha ${record.issueDate})`,
      []
    );
  }
};

const obtainCae = async (start: InvoiceDoc, deps: IssueInvoiceDeps): Promise<InvoiceDoc> => {
  let invoice = start;
  for (let conflicts = 0; ; conflicts += 1) {
    let number = invoice.number;

    if (number == null) {
      invoice = await reserveNumber(invoice, deps);
      number = invoice.number as number;
    } else if (await numberTakenByAnother(invoice, number)) {
      invoice = await clearNumber(invoice);
      continue;
    } else {
      const stored = await deps.client.consult(number);
      if (stored) {
        adoptStored(invoice, stored);
        const adopted = await authorize(invoice, stored, deps);
        if (adopted) return adopted;
        invoice = await clearNumber(invoice);
        continue;
      }
    }

    // Only now: if ARCA already had this number we adopted it above, with its original date.
    invoice = await refreshStaleIssueDate(invoice, (deps.now ?? (() => new Date()))());

    try {
      const result = await deps.client.requestCae({ number, total: invoice.total, issueDate: invoice.issuedAt });
      const authorized = await authorize(invoice, result, deps);
      if (authorized) return authorized;
      invoice = await clearNumber(invoice);
    } catch (error) {
      const numberConflict = error instanceof ArcaRejectedError && error.codes.includes(NUMBER_CONFLICT_CODE);
      if (!numberConflict || conflicts >= MAX_NUMBER_CONFLICTS) throw error;
      invoice = await clearNumber(invoice);
    }
  }
};

/** Leaves the invoice in `status`, releases the lease and keeps any reserved number for the next attempt. */
const close = async (invoice: InvoiceDoc, status: 'pending' | 'failed', message: string): Promise<IssueInvoiceResult> => {
  const closed = await Invoice.findByIdAndUpdate(invoice._id, { $set: { status, lastError: message, lockedUntil: null } }, { new: true });
  return toResult(closed ?? invoice, false);
};

/**
 * Issues (or finishes issuing) the Factura C of an inscription. Safe to call repeatedly and concurrently:
 * - one invoice per inscription (unique index);
 * - a lease keeps two workers from asking ARCA for the same invoice;
 * - the number is stored before asking ARCA, so a lost answer is reconciled instead of duplicated.
 * Never throws for ARCA problems: unreachable stays `pending` (retry later), refused becomes `failed`.
 */
export const issueInvoiceForInscription = async (input: IssueInvoiceInput, deps: IssueInvoiceDeps): Promise<IssueInvoiceResult> => {
  const now = (deps.now ?? (() => new Date()))();
  const invoice = await findOrCreate(input, deps, now);
  if (invoice.status !== 'pending') return toResult(invoice, false);
  if (invoice.environment !== deps.config.environment) {
    // Never send another environment's invoice to this environment's ARCA (shared database, preview vs production).
    logger.warn('[Invoicing] Factura de otro entorno, se omite', { invoiceId: String(invoice._id), environment: invoice.environment });
    return toResult(invoice, false);
  }

  const claimed = await claim(invoice, now);
  if (!claimed) return toResult((await Invoice.findById(invoice._id)) ?? invoice, false);

  try {
    return toResult(await obtainCae(claimed, deps), true);
  } catch (error) {
    if (error instanceof ArcaRejectedError) return close(claimed, 'failed', error.message);
    if (error instanceof ArcaUnavailableError) return close(claimed, 'pending', error.message);
    await Invoice.updateOne({ _id: claimed._id }, { $set: { lockedUntil: null } });
    throw error;
  }
};
