import mongoose from 'mongoose';
import CreditNote from '../../models/CreditNote/index.js';
import Invoice from '../../models/Invoice/index.js';
import { sendEmail } from '../emailServices.js';
import { escapeHtml } from '../fsTemplate.js';
import { logger } from '../logger.js';
import { buildInvoiceUrl } from './invoiceUrl.js';

export type EmailSender = typeof sendEmail;

/** Emails the invoice link to its receiver and records when. False when it was not sent (not authorized or send failed). */
export const sendInvoiceEmail = async (invoiceId: string, send: EmailSender = sendEmail): Promise<boolean> => {
  if (!mongoose.isValidObjectId(invoiceId)) return false;
  const invoice = await Invoice.findById(invoiceId).lean();
  if (!invoice || invoice.status !== 'authorized' || !invoice.receiver?.email) return false;

  const courseTitle = invoice.lines[0]?.description ?? 'tu curso';
  try {
    await send({
      to: invoice.receiver.email,
      subject: `Tu factura de "${courseTitle}"`,
      templateName: 'invoiceReady',
      data: {
        name: escapeHtml(invoice.receiver.name ?? ''),
        courseTitle: escapeHtml(courseTitle),
        invoiceUrl: escapeHtml(buildInvoiceUrl(invoice.publicToken)),
        year: new Date().getFullYear().toString(),
      },
    });
  } catch (error) {
    logger.error('[Invoicing] No se pudo enviar el mail de la factura', {
      invoiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  await Invoice.updateOne({ _id: invoice._id }, { $set: { emailSentAt: new Date() } });
  return true;
};

/** Records that the access email already carried the invoice link, so the retry job does not send it twice. */
export const markInvoiceEmailed = async (inscriptionId: string): Promise<void> => {
  try {
    await Invoice.updateOne({ inscriptionId }, { $set: { emailSentAt: new Date() } });
  } catch (error) {
    logger.error('[Invoicing] No se pudo registrar el envío de la factura', {
      inscriptionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/** Emails the credit note link to its receiver and records when. False when it was not sent. */
export const sendCreditNoteEmail = async (creditNoteId: string, send: EmailSender = sendEmail): Promise<boolean> => {
  const note = await CreditNote.findById(creditNoteId).lean();
  if (!note || note.status !== 'authorized' || !note.receiver?.email) return false;

  const courseTitle = note.lines[0]?.description ?? 'tu curso';
  try {
    await send({
      to: note.receiver.email,
      subject: `Nota de crédito de "${courseTitle}"`,
      templateName: 'creditNoteReady',
      data: {
        name: escapeHtml(note.receiver.name ?? ''),
        courseTitle: escapeHtml(courseTitle),
        creditNoteUrl: escapeHtml(buildInvoiceUrl(note.publicToken)),
        year: new Date().getFullYear().toString(),
      },
    });
  } catch (error) {
    logger.error('[Invoicing] No se pudo enviar el mail de la nota de crédito', {
      creditNoteId,
      // Not the message: SMTP refusals quote the receiver's address.
      code: error instanceof Error && 'code' in error ? error.code : undefined,
    });
    return false;
  }
  await CreditNote.updateOne({ _id: note._id }, { $set: { emailSentAt: new Date() } });
  return true;
};
