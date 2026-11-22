import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import Invoice from '../../models/Invoice/index.js';
import { buildInvoiceUrl } from '../../services/invoicing/invoiceUrl.js';
import type { InvoicesServices } from './types.js';

const PUBLIC_TOKEN = /^[a-f0-9]{64}$/;

const listQuery = z.object({
  status: z.enum(['pending', 'authorized', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
});

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type InvoiceRecord = Awaited<ReturnType<typeof findOneLean>>;
const findOneLean = () => Invoice.findOne().lean();

/** What the public page may show: no email, no ids, nothing that is not printed on the invoice. */
const toPublicView = (invoice: NonNullable<InvoiceRecord>) => ({
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

const toAdminView = (invoice: NonNullable<InvoiceRecord>) => ({
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
});

export const createInvoicesController = (services: InvoicesServices) => ({
  /** Public: the invoice behind an unguessable token, only once ARCA authorized it. */
  getPublicInvoice: async (req: Request, res: Response): Promise<void> => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    const token = String(req.params.token);
    const invoice = PUBLIC_TOKEN.test(token) ? await Invoice.findOne({ publicToken: token, status: 'authorized' }).lean() : null;
    if (!invoice) {
      res.status(404).json({ success: false, message: 'No encontrada' });
      return;
    }
    res.status(200).json(toPublicView(invoice));
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
    res.status(200).json({ items: items.map(toAdminView), page, limit, total });
  },

  getInvoice: async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const invoice = mongoose.isValidObjectId(id) ? await Invoice.findById(id).lean() : null;
    if (!invoice) {
      res.status(404).json({ success: false, message: 'No encontrada' });
      return;
    }
    res.status(200).json(toAdminView(invoice));
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
});
