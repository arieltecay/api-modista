import { argentinaDay } from './dates.js';
import type { FiscalQrInput } from './types.js';

const QR_BASE_URL = 'https://www.afip.gob.ar/fe/qr/';
const FACTURA_C = 11;
const FINAL_CONSUMER_DOCUMENT = 99;

/** QR url of an authorized Factura C to a final consumer (ARCA RG 4291: `?p=` + base64 JSON). */
export const buildFiscalQrUrl = (input: FiscalQrInput): string => {
  const payload = {
    ver: 1,
    fecha: argentinaDay(input.issueDate),
    cuit: Number(input.cuit),
    ptoVta: input.pointOfSale,
    tipoCmp: FACTURA_C,
    nroCmp: input.number,
    importe: input.total,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: FINAL_CONSUMER_DOCUMENT,
    nroDocRec: 0,
    tipoCodAut: 'E',
    codAut: Number(input.cae),
  };
  return `${QR_BASE_URL}?p=${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
};
