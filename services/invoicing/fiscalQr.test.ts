import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFiscalQrUrl } from './fiscalQr.js';

test('builds the ARCA QR url with the RG 4291 payload', () => {
  const url = new URL(
    buildFiscalQrUrl({
      cuit: '27346513670',
      pointOfSale: 2,
      number: 37,
      total: 20900,
      issueDate: new Date('2026-11-21T15:00:00-03:00'),
      cae: '86473873429798',
    })
  );

  assert.equal(`${url.origin}${url.pathname}`, 'https://www.afip.gob.ar/fe/qr/');
  const payload = JSON.parse(Buffer.from(url.searchParams.get('p') ?? '', 'base64').toString('utf8'));
  assert.deepEqual(payload, {
    ver: 1,
    fecha: '2026-11-21',
    cuit: 27346513670,
    ptoVta: 2,
    tipoCmp: 11,
    nroCmp: 37,
    importe: 20900,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: 99,
    nroDocRec: 0,
    tipoCodAut: 'E',
    codAut: 86473873429798,
  });
});

test('uses the Argentina calendar day even when UTC is already the next day', () => {
  const url = new URL(
    buildFiscalQrUrl({ cuit: '27346513670', pointOfSale: 2, number: 1, total: 1, issueDate: new Date('2026-11-22T01:30:00Z'), cae: '1' })
  );
  const payload = JSON.parse(Buffer.from(url.searchParams.get('p') ?? '', 'base64').toString('utf8'));
  assert.equal(payload.fecha, '2026-11-21');
});
