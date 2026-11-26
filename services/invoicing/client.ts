import { signLoginTicketRequest } from './cms.js';
import { ArcaRejectedError, ArcaUnavailableError } from './errors.js';
import { buildLoginSoap, buildLoginTicketRequest, parseLoginResponse } from './wsaa.js';
import {
  WSFE_ACTION_PREFIX,
  buildCaeSoap,
  buildConsultSoap,
  buildLastAuthorizedSoap,
  parseCae,
  parseConsult,
  parseLastAuthorized,
} from './wsfe.js';
import type { ArcaConfig, ArcaInvoiceRecord, ArcaTicket, ArcaTicketStore, ArcaTransport, CaeRequest, CaeResult, VoucherKind } from './types.js';

const ENDPOINTS = {
  homologation: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  production: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
} as const;

const TICKET_SAFETY_MARGIN_MS = 60_000;

interface ArcaClientDeps {
  config: ArcaConfig;
  transport: ArcaTransport;
  ticketStore: ArcaTicketStore;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface ArcaClient {
  /** Last number ARCA authorized for that kind (an invoice by default) at the configured point of sale. */
  lastAuthorized: (kind?: VoucherKind) => Promise<number>;
  requestCae: (request: CaeRequest) => Promise<CaeResult>;
  /** Voucher stored under `number`, or null if ARCA has none (used to reconcile a lost response). */
  consult: (number: number, kind?: VoucherKind) => Promise<ArcaInvoiceRecord | null>;
}

export const createArcaClient = ({ config, transport, ticketStore, now = () => new Date() }: ArcaClientDeps): ArcaClient => {
  const endpoints = ENDPOINTS[config.environment];

  const send = async (url: string, soapAction: string, body: string): Promise<string> => {
    try {
      return await transport({ url, soapAction, body });
    } catch (error) {
      if (error instanceof ArcaUnavailableError || error instanceof ArcaRejectedError) throw error;
      throw new ArcaUnavailableError(`No se pudo contactar a ARCA: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const login = async (): Promise<ArcaTicket> => {
    const cms = signLoginTicketRequest(buildLoginTicketRequest(now()), config.certificatePem, config.privateKeyPem);
    const ticket = parseLoginResponse(await send(endpoints.wsaa, '', buildLoginSoap(cms)));
    await ticketStore.save(ticket);
    return ticket;
  };

  const getTicket = async (): Promise<ArcaTicket> => {
    const stored = await ticketStore.load();
    const stillValid = stored && stored.expiresAt.getTime() - now().getTime() > TICKET_SAFETY_MARGIN_MS;
    return stillValid ? stored : login();
  };

  /** Sends a WSFE call and parses the answer; an invalid-token answer also drops the stored ticket. */
  const callWsfe = async <T>(operation: string, buildBody: (ticket: ArcaTicket) => string, parse: (xml: string) => T): Promise<T> => {
    const ticket = await getTicket();
    const xml = await send(endpoints.wsfe, `${WSFE_ACTION_PREFIX}${operation}`, buildBody(ticket));
    try {
      return parse(xml);
    } catch (error) {
      if (error instanceof ArcaUnavailableError && error.invalidatesTicket) await ticketStore.clear?.();
      throw error;
    }
  };

  return {
    lastAuthorized: (kind) =>
      callWsfe('FECompUltimoAutorizado', (ticket) => buildLastAuthorizedSoap(config, ticket, kind), parseLastAuthorized),
    requestCae: (request) => callWsfe('FECAESolicitar', (ticket) => buildCaeSoap(config, ticket, request), parseCae),
    consult: (number, kind) => callWsfe('FECompConsultar', (ticket) => buildConsultSoap(config, ticket, number, kind), parseConsult),
  };
};
