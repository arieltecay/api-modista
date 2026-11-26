import crypto from 'node:crypto';
import mongoose, { type Model } from 'mongoose';
import CreditNote from '../../models/CreditNote/index.js';
import Invoice from '../../models/Invoice/index.js';
import { logger } from '../logger.js';
import { isDuplicateKey, issueVoucher, type VoucherSpec } from './issueVoucher.js';
import { sendCreditNoteEmail, type EmailSender } from './notify.js';
import type { CreditNoteInput, CreditNoteOutcome, IssueInvoiceDeps, VoucherFields, VoucherResult } from './types.js';

type InvoiceDoc = InstanceType<typeof Invoice>;
type CreditNoteDoc = InstanceType<typeof CreditNote>;

export interface CreditNoteRetrySummary {
  processed: number;
  authorized: number;
}

interface CreditNoteOptions {
  deps: IssueInvoiceDeps;
  send?: EmailSender;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_BUDGET_MS = 25_000;

/** Why the invoice cannot be credited from this deployment, or null when it can. */
const notAllowedReason = (invoice: InvoiceDoc, { config }: IssueInvoiceDeps): string | null => {
  if (invoice.status !== 'authorized' || invoice.number == null) return 'La factura no está autorizada por ARCA';
  if (invoice.environment !== config.environment) return 'La factura es de otro entorno';
  if (invoice.pointOfSale !== config.pointOfSale) return 'La factura es de otro punto de venta';
  return null;
};

const findOrCreate = async (invoice: InvoiceDoc, input: CreditNoteInput, issuedAt: Date): Promise<CreditNoteDoc> => {
  // The unique index is the only "one per invoice" guard: it must exist before the first insert.
  await CreditNote.init();
  const existing = await CreditNote.findOne({ invoiceId: invoice._id });
  if (existing) return existing;
  // Copies, never references: later edits must not change an issued document.
  const { lines, receiver, emitter } = invoice.toObject();
  try {
    return await CreditNote.create({
      invoiceId: invoice._id,
      creditedInvoice: { pointOfSale: invoice.pointOfSale, number: invoice.number, issueDate: invoice.issuedAt },
      reason: input.reason,
      createdBy: input.createdBy,
      environment: invoice.environment,
      pointOfSale: invoice.pointOfSale,
      issuedAt,
      total: invoice.total,
      lines,
      receiver,
      emitter,
      publicToken: crypto.randomBytes(32).toString('hex'),
    });
  } catch (error) {
    const raced = isDuplicateKey(error) ? await CreditNote.findOne({ invoiceId: invoice._id }) : null;
    if (raced) return raced;
    throw error;
  }
};

const specOf = (note: CreditNoteDoc): VoucherSpec => {
  const credited = note.creditedInvoice;
  if (!credited) throw new Error('Credit note without its invoice');
  return {
    kind: 'credit_note',
    label: 'Nota de crédito',
    idKey: 'creditNoteId',
    model: CreditNote as unknown as Model<VoucherFields>,
    credits: { pointOfSale: credited.pointOfSale, number: credited.number, issueDate: credited.issueDate },
  };
};

/** Asks ARCA and, only if this call obtained the CAE, emails the receiver. */
const issueAndEmail = async (note: CreditNoteDoc, { deps, send }: CreditNoteOptions): Promise<VoucherResult> => {
  const result = await issueVoucher(String(note._id), specOf(note), deps);
  if (result.issued) await sendCreditNoteEmail(result.id, send);
  return result;
};

const done = ({ status, issued }: VoucherResult): CreditNoteOutcome => ({ kind: 'done', result: { status, issued } });

/** Cancels a whole authorized invoice with a Nota de Crédito C. Idempotent: one per invoice. It does not refund money. */
export const issueCreditNote = async (input: CreditNoteInput, options: CreditNoteOptions): Promise<CreditNoteOutcome> => {
  const invoice = mongoose.isValidObjectId(input.invoiceId) ? await Invoice.findById(input.invoiceId) : null;
  if (!invoice) return { kind: 'not_found' };
  const reason = notAllowedReason(invoice, options.deps);
  if (reason) return { kind: 'not_allowed', reason };

  const note = await findOrCreate(invoice, input, (options.deps.now ?? (() => new Date()))());
  return done(await issueAndEmail(note, options));
};

/** Admin retry: reopens the credit note if ARCA had refused it. */
export const retryCreditNote = async (invoiceId: string, options: CreditNoteOptions): Promise<CreditNoteOutcome> => {
  const note = mongoose.isValidObjectId(invoiceId) ? await CreditNote.findOne({ invoiceId }) : null;
  if (!note) return { kind: 'not_found' };
  const { environment, pointOfSale } = options.deps.config;
  if (note.environment !== environment || note.pointOfSale !== pointOfSale) {
    return { kind: 'not_allowed', reason: 'La nota de crédito es de otro entorno o punto de venta' };
  }

  await CreditNote.updateOne({ _id: note._id, status: 'failed' }, { $set: { status: 'pending' }, $unset: { lastError: 1 } });
  return done(await issueAndEmail(note, options));
};

/** Emails again the credit note of an invoice. False when there is none authorized or the send failed. */
export const resendCreditNote = async (invoiceId: string, send?: EmailSender): Promise<boolean> => {
  const note = mongoose.isValidObjectId(invoiceId) ? await CreditNote.findOne({ invoiceId }).select('_id').lean() : null;
  return note ? sendCreditNoteEmail(String(note._id), send) : false;
};

/** Finishes the credit notes ARCA left unanswered. Stops starting new ones once `budgetMs` is spent. */
export const retryPendingCreditNotes = async ({
  budgetMs = DEFAULT_BUDGET_MS,
  ...options
}: CreditNoteOptions & { budgetMs?: number }): Promise<CreditNoteRetrySummary> => {
  const startedAt = Date.now();
  const now = (options.deps.now ?? (() => new Date()))();
  const { environment, pointOfSale } = options.deps.config;
  const pending = await CreditNote.find({
    status: 'pending',
    environment,
    pointOfSale,
    $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
  })
    .sort({ updatedAt: 1 })
    .limit(DEFAULT_LIMIT);

  const summary = { processed: 0, authorized: 0 };
  for (const note of pending) {
    if (Date.now() - startedAt >= budgetMs) break;
    summary.processed += 1;
    try {
      const result = await issueAndEmail(note, options);
      if (result.status === 'authorized') summary.authorized += 1;
    } catch (error) {
      // One broken note must not block the rest of the batch.
      logger.error('[Invoicing] Falló el reintento de una nota de crédito', {
        creditNoteId: String(note._id),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summary;
};
