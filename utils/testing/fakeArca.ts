import { ArcaRejectedError, ArcaUnavailableError } from '../../services/invoicing/errors.js';
import type { ArcaClientPort, ArcaInvoiceRecord, CaeRequest, VoucherKind } from '../../services/invoicing/types.js';

export const FAKE_ARCA_DAY = '2026-11-21';

export interface FakeArca {
  client: ArcaClientPort;
  state: {
    requests: CaeRequest[];
    /** Errors thrown by the next `requestCae` calls, in order. */
    failNext: Error[];
    /** Persist the invoice at ARCA but lose the answer (timeout after processing). */
    loseAnswerOnce: boolean;
  };
  /** Invoices ARCA holds, by number. */
  stored: Map<number, ArcaInvoiceRecord>;
  /** Credit notes ARCA holds, by number: numbered apart from invoices. */
  storedCreditNotes: Map<number, ArcaInvoiceRecord>;
}

/** In-memory ARCA: authorizes sequential numbers and can be told to fail. */
export const createFakeArca = (): FakeArca => {
  const stored = new Map<number, ArcaInvoiceRecord>();
  const storedCreditNotes = new Map<number, ArcaInvoiceRecord>();
  const book = (kind: VoucherKind = 'invoice') => (kind === 'invoice' ? stored : storedCreditNotes);
  const state: FakeArca['state'] = { requests: [], failNext: [], loseAnswerOnce: false };
  const client: ArcaClientPort = {
    lastAuthorized: async (kind) => Math.max(0, ...book(kind).keys()),
    consult: async (number, kind) => book(kind).get(number) ?? null,
    requestCae: async (request) => {
      state.requests.push(request);
      const failure = state.failNext.shift();
      if (failure) throw failure;
      const held = book(request.credits ? 'credit_note' : 'invoice');
      if (held.has(request.number)) throw new ArcaRejectedError('numero invalido', ['10016']);
      const record: ArcaInvoiceRecord = {
        number: request.number,
        cae: `CAE${request.number}`,
        caeExpiresAt: '2026-12-01',
        total: request.total,
        issueDate: FAKE_ARCA_DAY,
        ...(request.credits ? { credits: { pointOfSale: request.credits.pointOfSale, number: request.credits.number } } : {}),
      };
      held.set(request.number, record);
      if (state.loseAnswerOnce) {
        state.loseAnswerOnce = false;
        throw new ArcaUnavailableError('timeout');
      }
      return { cae: record.cae, caeExpiresAt: record.caeExpiresAt, number: record.number };
    },
  };
  return { client, state, stored, storedCreditNotes };
};
