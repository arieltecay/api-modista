import crypto from 'node:crypto';
import type { Model } from 'mongoose';
import Invoice from '../../models/Invoice/index.js';
import { logger } from '../logger.js';
import { isDuplicateKey, issueVoucher } from './issueVoucher.js';
import { roundMoney } from './money.js';
import type { IssueInvoiceDeps, IssueInvoiceInput, IssueInvoiceResult, VoucherFields } from './types.js';

type InvoiceDoc = InstanceType<typeof Invoice>;

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

/** Issues (or finishes issuing) the Factura C of an inscription: one per inscription (unique index). See `issueVoucher`. */
export const issueInvoiceForInscription = async (input: IssueInvoiceInput, deps: IssueInvoiceDeps): Promise<IssueInvoiceResult> => {
  const now = (deps.now ?? (() => new Date()))();
  const invoice = await findOrCreate(input, deps, now);
  const { id, status, issued } = await issueVoucher(
    String(invoice._id),
    { kind: 'invoice', label: 'Factura', idKey: 'invoiceId', model: Invoice as unknown as Model<VoucherFields> },
    deps
  );
  return { invoiceId: id, status, issued };
};
