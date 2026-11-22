import { argentinaDay, fromArcaDate, toArcaDate } from './dates.js';
import { ArcaRejectedError, ArcaUnavailableError } from './errors.js';
import { asList, asNode, soapBody, soapEnvelope, text } from './soap.js';
import type { ArcaConfig, ArcaInvoiceRecord, ArcaTicket, CaeRequest, CaeResult } from './types.js';

const NAMESPACE = 'http://ar.gov.afip.dif.FEV1/';
export const WSFE_ACTION_PREFIX = NAMESPACE;
const FACTURA_C = 11;
const SERVICES_CONCEPT = 2;
const FINAL_CONSUMER_DOCUMENT = 99;
const FINAL_CONSUMER_IVA_CONDITION = 5;
const NOT_FOUND_CODE = '602';
/** ARCA internal errors (database, authentication service, unavailable): the same request may work later. */
const TRANSIENT_CODES = new Set(['500', '501', '502', '503', '600']);
/** The access token itself is no longer valid (expired or revoked). */
const INVALID_TOKEN_CODE = '600';

const money = (value: number): string => value.toFixed(2);

const auth = (config: ArcaConfig, ticket: ArcaTicket): string =>
  `<Auth><Token>${ticket.token}</Token><Sign>${ticket.sign}</Sign><Cuit>${config.cuit}</Cuit></Auth>`;

const call = (operation: string, content: string): string =>
  soapEnvelope(`<${operation} xmlns="${NAMESPACE}">${content}</${operation}>`);

export const buildLastAuthorizedSoap = (config: ArcaConfig, ticket: ArcaTicket): string =>
  call(
    'FECompUltimoAutorizado',
    `${auth(config, ticket)}<PtoVta>${config.pointOfSale}</PtoVta><CbteTipo>${FACTURA_C}</CbteTipo>`
  );

export const buildConsultSoap = (config: ArcaConfig, ticket: ArcaTicket, number: number): string =>
  call(
    'FECompConsultar',
    `${auth(config, ticket)}<FeCompConsReq><CbteTipo>${FACTURA_C}</CbteTipo><CbteNro>${number}</CbteNro><PtoVta>${config.pointOfSale}</PtoVta></FeCompConsReq>`
  );

/** Factura C for a service paid and delivered on the issue date, to a final consumer. */
export const buildCaeSoap = (config: ArcaConfig, ticket: ArcaTicket, request: CaeRequest): string => {
  const day = toArcaDate(argentinaDay(request.issueDate));
  const total = money(request.total);
  const detail =
    `<Concepto>${SERVICES_CONCEPT}</Concepto><DocTipo>${FINAL_CONSUMER_DOCUMENT}</DocTipo><DocNro>0</DocNro>` +
    `<CbteDesde>${request.number}</CbteDesde><CbteHasta>${request.number}</CbteHasta><CbteFch>${day}</CbteFch>` +
    `<ImpTotal>${total}</ImpTotal><ImpTotConc>0.00</ImpTotConc><ImpNeto>${total}</ImpNeto><ImpOpEx>0.00</ImpOpEx>` +
    `<ImpTrib>0.00</ImpTrib><ImpIVA>0.00</ImpIVA><FchServDesde>${day}</FchServDesde><FchServHasta>${day}</FchServHasta>` +
    `<FchVtoPago>${day}</FchVtoPago><MonId>PES</MonId><MonCotiz>1</MonCotiz>` +
    `<CondicionIVAReceptorId>${FINAL_CONSUMER_IVA_CONDITION}</CondicionIVAReceptorId>`;
  return call(
    'FECAESolicitar',
    `${auth(config, ticket)}<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${config.pointOfSale}</PtoVta><CbteTipo>${FACTURA_C}</CbteTipo></FeCabReq>` +
      `<FeDetReq><FECAEDetRequest>${detail}</FECAEDetRequest></FeDetReq></FeCAEReq>`
  );
};

/** Codes and messages of every `Err` and `Obs` ARCA attached to a result. */
const problems = (result: Record<string, unknown>, detail: Record<string, unknown> = {}) => {
  const items = [
    ...asList(asNode(result.Errors).Err),
    ...asList(asNode(detail.Observaciones).Obs),
    ...asList(asNode(detail.Errors).Err),
  ];
  return items.map((item) => ({ code: text(item.Code) ?? '?', message: text(item.Msg) ?? '' }));
};

/** A refusal (retrying the same data will not help) or, for ARCA's own errors, something worth retrying. */
const rejection = (list: ReturnType<typeof problems>): ArcaRejectedError | ArcaUnavailableError => {
  const message = list.length ? list.map((item) => `${item.code}: ${item.message}`).join(' | ') : 'ARCA rechazó el comprobante';
  const codes = list.map((item) => item.code);
  if (codes.some((code) => TRANSIENT_CODES.has(code))) {
    return new ArcaUnavailableError(message, codes.includes(INVALID_TOKEN_CODE));
  }
  return new ArcaRejectedError(message, codes);
};

export const parseLastAuthorized = (xml: string): number => {
  const result = asNode(asNode(soapBody(xml).FECompUltimoAutorizadoResponse).FECompUltimoAutorizadoResult);
  const number = text(result.CbteNro);
  if (number === undefined) throw rejection(problems(result));
  return Number(number);
};

export const parseCae = (xml: string): CaeResult => {
  const result = asNode(asNode(soapBody(xml).FECAESolicitarResponse).FECAESolicitarResult);
  const detail = asNode(asNode(result.FeDetResp).FECAEDetResponse);
  const cae = text(detail.CAE);
  const expires = text(detail.CAEFchVto);

  if (text(detail.Resultado) !== 'A' || !cae || !expires) throw rejection(problems(result, detail));
  return { cae, caeExpiresAt: fromArcaDate(expires), number: Number(text(detail.CbteDesde)) };
};

/** The invoice ARCA has stored under that number, or null when none exists. */
export const parseConsult = (xml: string): ArcaInvoiceRecord | null => {
  const result = asNode(asNode(soapBody(xml).FECompConsultarResponse).FECompConsultarResult);
  const found = asNode(result.ResultGet);
  const cae = text(found.CodAutorizacion);

  if (cae) {
    return {
      number: Number(text(found.CbteDesde)),
      cae,
      caeExpiresAt: fromArcaDate(text(found.FchVto) ?? ''),
      total: Number(text(found.ImpTotal)),
      issueDate: fromArcaDate(text(found.CbteFch) ?? ''),
    };
  }
  const list = problems(result);
  if (list.some((item) => item.code === NOT_FOUND_CODE)) return null;
  throw rejection(list);
};
