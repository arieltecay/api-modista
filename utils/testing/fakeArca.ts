import { ArcaRejectedError, ArcaUnavailableError } from '../../services/invoicing/errors.js';
import type { ArcaClientPort, ArcaInvoiceRecord, CaeRequest } from '../../services/invoicing/types.js';

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
}

/** In-memory ARCA: authorizes sequential numbers and can be told to fail. */
export const createFakeArca = (): FakeArca => {
  const stored = new Map<number, ArcaInvoiceRecord>();
  const state: FakeArca['state'] = { requests: [], failNext: [], loseAnswerOnce: false };
  const client: ArcaClientPort = {
    lastAuthorized: async () => Math.max(0, ...stored.keys()),
    consult: async (number) => stored.get(number) ?? null,
    requestCae: async (request) => {
      state.requests.push(request);
      const failure = state.failNext.shift();
      if (failure) throw failure;
      if (stored.has(request.number)) throw new ArcaRejectedError('numero invalido', ['10016']);
      const record: ArcaInvoiceRecord = {
        number: request.number,
        cae: `CAE${request.number}`,
        caeExpiresAt: '2026-12-01',
        total: request.total,
        issueDate: FAKE_ARCA_DAY,
      };
      stored.set(request.number, record);
      if (state.loseAnswerOnce) {
        state.loseAnswerOnce = false;
        throw new ArcaUnavailableError('timeout');
      }
      return { cae: record.cae, caeExpiresAt: record.caeExpiresAt, number: record.number };
    },
  };
  return { client, state, stored };
};
