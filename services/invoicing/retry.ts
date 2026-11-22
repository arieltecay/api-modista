import mongoose from 'mongoose';
import Invoice from '../../models/Invoice/index.js';
import { logger } from '../logger.js';
import { issueInvoiceForInscription } from './issueInvoice.js';
import { sendInvoiceEmail, type EmailSender } from './notify.js';
import type { IssueInvoiceDeps, IssueInvoiceInput, IssueInvoiceResult } from './types.js';

type InvoiceDoc = InstanceType<typeof Invoice>;

const DEFAULT_LIMIT = 10;
/** Leaves room inside a serverless function: every invoice may wait up to 15 s on ARCA. */
const DEFAULT_BUDGET_MS = 25_000;

export interface RetryOptions {
  deps: IssueInvoiceDeps;
  send?: EmailSender;
  /** Most invoices handled per run (each one may wait on ARCA). */
  limit?: number;
  /** Stop starting new invoices after this long (at least one is always handled). */
  budgetMs?: number;
}

export interface RetrySummary {
  processed: number;
  authorized: number;
  failed: number;
  stillPending: number;
}

const inputFrom = (invoice: InvoiceDoc): IssueInvoiceInput => ({
  inscriptionId: String(invoice.inscriptionId),
  total: invoice.total,
  description: invoice.lines[0]?.description ?? 'Curso',
  receiverName: invoice.receiver?.name ?? '',
  receiverEmail: invoice.receiver?.email ?? '',
  mpPaymentId: invoice.mpPaymentId ?? undefined,
});

/** Emails the receiver unless the access email already carried the link. */
const emailIfNew = async (invoiceId: string, send?: EmailSender): Promise<void> => {
  const fresh = await Invoice.findById(invoiceId).select('emailSentAt').lean();
  if (fresh && !fresh.emailSentAt) await sendInvoiceEmail(invoiceId, send);
};

/** Finishes the invoices that were left `pending` (ARCA was down or slow) for the current environment. */
export const retryPendingInvoices = async ({
  deps,
  send,
  limit = DEFAULT_LIMIT,
  budgetMs = DEFAULT_BUDGET_MS,
}: RetryOptions): Promise<RetrySummary> => {
  const startedAt = Date.now();
  const now = (deps.now ?? (() => new Date()))();
  const pending = await Invoice.find({
    status: 'pending',
    environment: deps.config.environment,
    $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
  })
    // Least recently tried first: an invoice that keeps failing moves to the back instead of starving the rest.
    .sort({ updatedAt: 1 })
    .limit(limit);

  const summary: RetrySummary = { processed: 0, authorized: 0, failed: 0, stillPending: 0 };
  for (const invoice of pending) {
    if (summary.processed > 0 && Date.now() - startedAt >= budgetMs) break;
    summary.processed += 1;
    let result: IssueInvoiceResult;
    try {
      result = await issueInvoiceForInscription(inputFrom(invoice), deps);
    } catch (error) {
      // An unexpected failure (certificate, database) on one invoice must not block the rest of the batch.
      logger.error('[Invoicing] Falló el reintento de una factura', {
        invoiceId: String(invoice._id),
        error: error instanceof Error ? error.message : String(error),
      });
      summary.stillPending += 1;
      continue;
    }
    if (result.status === 'authorized') {
      summary.authorized += 1;
      await emailIfNew(result.invoiceId, send);
    } else if (result.status === 'failed') {
      summary.failed += 1;
    } else {
      summary.stillPending += 1;
    }
  }
  return summary;
};

/** Admin retry of one invoice: reopens it if ARCA had refused it, issues it and emails the receiver. Null if unknown. */
export const retryInvoiceById = async (
  invoiceId: string,
  { deps, send }: Pick<RetryOptions, 'deps' | 'send'>
): Promise<IssueInvoiceResult | null> => {
  if (!mongoose.isValidObjectId(invoiceId)) return null;
  const invoice = await Invoice.findById(invoiceId);
  // An invoice of another environment must never be sent to this environment's ARCA.
  if (!invoice || invoice.environment !== deps.config.environment) return null;

  if (invoice.status === 'failed') {
    await Invoice.updateOne({ _id: invoice._id, status: 'failed' }, { $set: { status: 'pending' }, $unset: { lastError: 1 } });
  }
  const result = await issueInvoiceForInscription(inputFrom(invoice), deps);
  if (result.issued) await emailIfNew(result.invoiceId, send);
  return result;
};
