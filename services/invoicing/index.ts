import Invoice from '../../models/Invoice/index.js';
import { logger } from '../logger.js';
import { createArcaClient } from './client.js';
import { buildInvoiceUrl } from './invoiceUrl.js';
import { issueInvoiceForInscription } from './issueInvoice.js';
import { resolveInvoicingSettings } from './settings.js';
import { createMongoTicketStore } from './ticketStore.js';
import { createHttpsTransport } from './transport.js';
import type {
  InvoiceLink,
  IssueInvoiceDeps,
  IssueInvoiceForPaymentOptions,
  PaymentInvoiceInput,
} from './types.js';

/** The payment flow waits at most this long for ARCA; a serverless function has little time left for the email. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Real ARCA client + settings for this deployment, or why invoicing is off. Shared by the payment flow, admin and cron. */
export const resolveIssueDeps = (
  options: Pick<IssueInvoiceForPaymentOptions, 'settings' | 'client'> = {}
): { deps: IssueInvoiceDeps } | { reason: string } => {
  const settings = options.settings ?? resolveInvoicingSettings();
  if (!settings.enabled) return { reason: settings.reason };

  const client =
    options.client ??
    createArcaClient({
      config: settings.config,
      transport: createHttpsTransport(),
      ticketStore: createMongoTicketStore(settings.config.environment, settings.config.cuit),
    });
  return { deps: { client, config: settings.config, emitter: settings.emitter } };
};

/** Resolves to `fallback` if `work` takes longer than `timeoutMs`; `work` keeps running and is reconciled later. */
const withDeadline = <T, F>(work: Promise<T>, timeoutMs: number, fallback: F): Promise<T | F> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/**
 * Issues the invoice of a fully paid inscription and returns its public page, or null when there is nothing
 * to show yet (disabled, ARCA down or slow, refused). Never throws: a payment must never fail because of billing.
 * A pending invoice is finished later by the retry job.
 */
export const issueInvoiceForPayment = async (
  input: PaymentInvoiceInput,
  options: IssueInvoiceForPaymentOptions = {}
): Promise<InvoiceLink | null> => {
  try {
    const resolved = resolveIssueDeps(options);
    if ('reason' in resolved) {
      logger.info(`[Invoicing] Facturación deshabilitada: ${resolved.reason}`);
      return null;
    }

    const result = await withDeadline(
      issueInvoiceForInscription(
        {
          inscriptionId: input.inscriptionId,
          total: input.total,
          description: input.courseTitle,
          receiverName: input.name,
          receiverEmail: input.email,
          mpPaymentId: input.mpPaymentId,
        },
        resolved.deps
      ),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      null
    );
    if (result?.status !== 'authorized') return null;

    const invoice = await Invoice.findById(result.invoiceId).select('publicToken').lean();
    return invoice ? { url: buildInvoiceUrl(invoice.publicToken) } : null;
  } catch (error) {
    logger.error('[Invoicing] Error emitiendo la factura', {
      inscriptionId: input.inscriptionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
