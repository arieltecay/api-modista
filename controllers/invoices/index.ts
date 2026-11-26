import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import CreditNote from '../../models/CreditNote/index.js';
import Invoice from '../../models/Invoice/index.js';
import { buildInvoiceUrl } from '../../services/invoicing/invoiceUrl.js';
import type { CreditNoteActionOutcome, InvoicesServices } from './types.js';

const PUBLIC_TOKEN = /^[a-f0-9]{64}$/;

const listQuery = z.object({
  status: z.enum(['pending', 'authorized', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
});

const creditNoteBody = z.object({ reason: z.string().trim().min(3).max(300) });

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type InvoiceRecord = Awaited<ReturnType<typeof findOneLean>>;
const findOneLean = () => Invoice.findOne().lean();
type CreditNoteRecord = Awaited<ReturnType<typeof findNoteLean>>;
const findNoteLean = () => CreditNote.findOne().lean();

/** What the public page may show: no email, no ids, nothing that is not printed on the invoice. */
const toPublicView = (invoice: NonNullable<InvoiceRecord> | NonNullable<CreditNoteRecord>) => ({
  environment: invoice.environment,
  emitter: invoice.emitter,
  receiver: { name: invoice.receiver?.name },
  pointOfSale: invoice.pointOfSale,
  number: invoice.number,
  issuedAt: invoice.issuedAt,
  lines: invoice.lines,
  total: invoice.total,
  cae: invoice.cae,
  caeExpiresAt: invoice.caeExpiresAt,
  fiscalQrUrl: invoice.fiscalQrUrl,
});

/** Same page as an invoice, plus the invoice it cancels (which is what tells them apart). */
const toPublicNoteView = (note: NonNullable<CreditNoteRecord>) => ({
  ...toPublicView(note),
  creditedInvoice: { pointOfSale: note.creditedInvoice?.pointOfSale, number: note.creditedInvoice?.number },
});

const toAdminNoteView = (note: NonNullable<CreditNoteRecord>) => ({
  status: note.status,
  pointOfSale: note.pointOfSale,
  number: note.number,
  issuedAt: note.issuedAt,
  emailSentAt: note.emailSentAt,
  lastError: note.lastError,
  reason: note.reason,
  publicUrl: note.status === 'authorized' ? buildInvoiceUrl(note.publicToken) : undefined,
});

const notesByInvoice = async (invoiceIds: unknown[]): Promise<Map<string, NonNullable<CreditNoteRecord>>> => {
  const notes = await CreditNote.find({ invoiceId: { $in: invoiceIds } }).lean();
  return new Map(notes.map((note) => [String(note.invoiceId), note]));
};

const toAdminView = (invoice: NonNullable<InvoiceRecord>, note?: NonNullable<CreditNoteRecord>) => ({
  id: String(invoice._id),
  status: invoice.status,
  environment: invoice.environment,
  pointOfSale: invoice.pointOfSale,
  number: invoice.number,
  total: invoice.total,
  cae: invoice.cae,
  caeExpiresAt: invoice.caeExpiresAt,
  courseTitle: invoice.lines[0]?.description,
  receiver: invoice.receiver,
  issuedAt: invoice.issuedAt,
  createdAt: invoice.createdAt,
  emailSentAt: invoice.emailSentAt,
  attempts: invoice.attempts,
  lastError: invoice.lastError,
  publicUrl: invoice.status === 'authorized' ? buildInvoiceUrl(invoice.publicToken) : undefined,
  creditNote: note ? toAdminNoteView(note) : undefined,
});

const sendCreditNoteOutcome = (res: Response, outcome: CreditNoteActionOutcome): void => {
  if (outcome.kind === 'not_found') res.status(404).json({ success: false, message: 'No encontrada' });
  else if (outcome.kind === 'not_allowed') res.status(409).json({ success: false, message: outcome.reason });
  else if (outcome.kind === 'disabled') res.status(503).json({ success: false, message: `Facturación deshabilitada: ${outcome.reason}` });
  else res.status(200).json(outcome.result);
};

export const createInvoicesController = (services: InvoicesServices) => ({
  /** Public: the invoice or credit note behind an unguessable token, only once ARCA authorized it. */
  getPublicInvoice: async (req: Request, res: Response): Promise<void> => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    const token = String(req.params.token);
    const query = { publicToken: token, status: 'authorized' as const };
    const invoice = PUBLIC_TOKEN.test(token) ? await Invoice.findOne(query).lean() : null;
    if (invoice) {
      res.status(200).json(toPublicView(invoice));
      return;
    }
    const note = PUBLIC_TOKEN.test(token) ? await CreditNote.findOne(query).lean() : null;
    if (!note) {
      res.status(404).json({ success: false, message: 'No encontrada' });
      return;
    }
    res.status(200).json(toPublicNoteView(note));
  },

  listInvoices: async (req: Request, res: Response): Promise<void> => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Parámetros inválidos' });
      return;
    }
    const { status, page, limit, q } = parsed.data;
    const search = q ? { $regex: escapeRegex(q), $options: 'i' } : undefined;
    const filter = {
      ...(status ? { status } : {}),
      ...(search ? { $or: [{ 'receiver.email': search }, { 'receiver.name': search }] } : {}),
    };

    const [items, total] = await Promise.all([
      Invoice.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(filter),
    ]);
    const notes = await notesByInvoice(items.map((item) => item._id));
    res.status(200).json({ items: items.map((item) => toAdminView(item, notes.get(String(item._id)))), page, limit, total });
  },

  getInvoice: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const invoice = mongoose.isValidObjectId(id) ? await Invoice.findById(id).lean() : null;
    if (!invoice) {
      res.status(404).json({ success: false, message: 'No encontrada' });
      return;
    }
    const notes = await notesByInvoice([invoice._id]);
    res.status(200).json(toAdminView(invoice, notes.get(id)));
  },

  retryInvoice: async (req: Request, res: Response): Promise<void> => {
    const outcome = await services.retry(String(req.params.id));
    if (outcome.kind === 'not_found') {
      res.status(404).json({ success: false, message: 'No encontrada' });
    } else if (outcome.kind === 'disabled') {
      res.status(503).json({ success: false, message: `Facturación deshabilitada: ${outcome.reason}` });
    } else {
      res.status(200).json(outcome.result);
    }
  },

  resendInvoice: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const invoice = mongoose.isValidObjectId(id) ? await Invoice.findById(id).select('status').lean() : null;
    if (!invoice) {
      res.status(404).json({ success: false, message: 'No encontrada' });
      return;
    }
    if (invoice.status !== 'authorized') {
      res.status(409).json({ success: false, message: 'La factura todavía no fue autorizada por ARCA' });
      return;
    }
    const sent = await services.resend(id);
    if (sent) res.status(200).json({ success: true, sent: true });
    else res.status(502).json({ success: false, message: 'No se pudo enviar el mail' });
  },

  issueCreditNote: async (req: Request, res: Response): Promise<void> => {
    const parsed = creditNoteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Indicá el motivo (entre 3 y 300 caracteres)' });
      return;
    }
    const createdBy = req.user?.userId;
    if (!createdBy) {
      res.status(401).json({ success: false, message: 'Sesión inválida' });
      return;
    }
    sendCreditNoteOutcome(res, await services.issueCreditNote({ invoiceId: String(req.params.id), reason: parsed.data.reason, createdBy }));
  },

  retryCreditNote: async (req: Request, res: Response): Promise<void> => {
    sendCreditNoteOutcome(res, await services.retryCreditNote(String(req.params.id)));
  },

  resendCreditNote: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const note = mongoose.isValidObjectId(id) ? await CreditNote.findOne({ invoiceId: id }).select('status').lean() : null;
    if (!note) {
      res.status(404).json({ success: false, message: 'No encontrada' });
      return;
    }
    if (note.status !== 'authorized') {
      res.status(409).json({ success: false, message: 'La nota de crédito todavía no fue autorizada por ARCA' });
      return;
    }
    if (await services.resendCreditNote(id)) res.status(200).json({ success: true, sent: true });
    else res.status(502).json({ success: false, message: 'No se pudo enviar el mail' });
  },
});
