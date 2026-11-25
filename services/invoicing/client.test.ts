import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestIdentity } from '../../utils/testing/arcaIdentity.js';
import { createArcaClient } from './client.js';
import { ArcaRejectedError, ArcaUnavailableError } from './errors.js';
import type { ArcaConfig, ArcaHttpRequest, ArcaTicket, ArcaTicketStore } from './types.js';

const identity = createTestIdentity();
const config: ArcaConfig = { cuit: '27346513670', pointOfSale: 2, environment: 'homologation', ...identity };
const NOW = new Date('2026-11-21T18:00:00Z');

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const loginResponse = (token: string, expiration: string) =>
  soap(
    `<loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>` +
      `&lt;?xml version="1.0" encoding="UTF-8" standalone="yes"?&gt;&lt;loginTicketResponse version="1.0"&gt;` +
      `&lt;header&gt;&lt;expirationTime&gt;${expiration}&lt;/expirationTime&gt;&lt;/header&gt;` +
      `&lt;credentials&gt;&lt;token&gt;${token}&lt;/token&gt;&lt;sign&gt;SIGN&lt;/sign&gt;&lt;/credentials&gt;` +
      `&lt;/loginTicketResponse&gt;</loginCmsReturn></loginCmsResponse>`
  );

const lastResponse = (number: number) =>
  soap(
    `<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult>` +
      `<PtoVta>2</PtoVta><CbteTipo>11</CbteTipo><CbteNro>${number}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`
  );

const caeResponse = (detail: string) =>
  soap(
    `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>` +
      `<FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse>${detail}</FECAEDetResponse></FeDetResp>` +
      `</FECAESolicitarResult></FECAESolicitarResponse>`
  );

const approved = caeResponse(
  '<CbteDesde>38</CbteDesde><CbteHasta>38</CbteHasta><Resultado>A</Resultado><CAE>86473873429798</CAE><CAEFchVto>20261201</CAEFchVto>'
);

interface Harness {
  requests: ArcaHttpRequest[];
  store: ArcaTicketStore & { saved: ArcaTicket[]; cleared: number };
}

const harness = (stored: ArcaTicket | null, respond: (request: ArcaHttpRequest) => string | Error): Harness & { client: ReturnType<typeof createArcaClient> } => {
  const requests: ArcaHttpRequest[] = [];
  const saved: ArcaTicket[] = [];
  const store = {
    saved,
    cleared: 0,
    load: async () => stored,
    save: async (ticket: ArcaTicket) => void saved.push(ticket),
    clear: async () => void (store.cleared += 1),
  };
  const transport = async (request: ArcaHttpRequest) => {
    requests.push(request);
    const response = respond(request);
    if (response instanceof Error) throw response;
    return response;
  };
  return { requests, store, client: createArcaClient({ config, transport, ticketStore: store, now: () => NOW }) };
};

const routeByAction = (map: Record<string, string>) => (request: ArcaHttpRequest) => {
  const key = Object.keys(map).find((action) => `${request.url} ${request.soapAction}`.includes(action));
  if (!key) throw new Error(`unexpected ${request.soapAction}`);
  return map[key];
};

test('logs in once, signs the request and stores the ticket', async () => {
  const { client, requests, store } = harness(null, routeByAction({ LoginCms: loginResponse('TOKEN', '2026-11-22T06:00:00.000-03:00'), FECompUltimoAutorizado: lastResponse(37) }));

  assert.equal(await client.lastAuthorized(), 37);

  assert.equal(requests[0].url, 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms');
  assert.match(requests[0].body, /<in0>[A-Za-z0-9+/=]{100,}<\/in0>/);
  assert.equal(requests[1].url, 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx');
  assert.match(requests[1].body, /<Token>TOKEN<\/Token><Sign>SIGN<\/Sign><Cuit>27346513670<\/Cuit>/);
  assert.match(requests[1].body, /<PtoVta>2<\/PtoVta><CbteTipo>11<\/CbteTipo>/);
  assert.equal(store.saved.length, 1);
});

test('reuses a stored ticket that is still valid and skips the login', async () => {
  const ticket = { token: 'STORED', sign: 'S', expiresAt: new Date(NOW.getTime() + 3_600_000) };
  const { client, requests } = harness(ticket, routeByAction({ FECompUltimoAutorizado: lastResponse(5) }));

  await client.lastAuthorized();

  assert.equal(requests.length, 1);
  assert.match(requests[0].body, /<Token>STORED<\/Token>/);
});

test('renews a ticket that expires within the safety margin', async () => {
  const nearlyExpired = { token: 'OLD', sign: 'S', expiresAt: new Date(NOW.getTime() + 30_000) };
  const { client, requests } = harness(nearlyExpired, routeByAction({ LoginCms: loginResponse('NEW', '2026-11-22T06:00:00.000-03:00'), FECompUltimoAutorizado: lastResponse(5) }));

  await client.lastAuthorized();

  assert.equal(requests.length, 2);
  assert.match(requests[1].body, /<Token>NEW<\/Token>/);
});

test('requests a Factura C for a final consumer and returns the CAE', async () => {
  const ticket = { token: 'T', sign: 'S', expiresAt: new Date(NOW.getTime() + 3_600_000) };
  const { client, requests } = harness(ticket, routeByAction({ FECAESolicitar: approved }));

  const result = await client.requestCae({ number: 38, total: 20900, issueDate: new Date('2026-11-21T15:00:00-03:00') });

  assert.deepEqual(result, { cae: '86473873429798', caeExpiresAt: '2026-12-01', number: 38 });
  const body = requests[0].body;
  assert.match(body, /<CbteTipo>11<\/CbteTipo>/);
  assert.match(body, /<Concepto>2<\/Concepto><DocTipo>99<\/DocTipo><DocNro>0<\/DocNro><CbteDesde>38<\/CbteDesde><CbteHasta>38<\/CbteHasta><CbteFch>20261121<\/CbteFch>/);
  assert.match(body, /<ImpTotal>20900\.00<\/ImpTotal><ImpTotConc>0\.00<\/ImpTotConc><ImpNeto>20900\.00<\/ImpNeto><ImpOpEx>0\.00<\/ImpOpEx><ImpTrib>0\.00<\/ImpTrib><ImpIVA>0\.00<\/ImpIVA>/);
  assert.match(body, /<FchServDesde>20261121<\/FchServDesde><FchServHasta>20261121<\/FchServHasta><FchVtoPago>20261121<\/FchVtoPago>/);
  assert.match(body, /<MonId>PES<\/MonId><MonCotiz>1<\/MonCotiz><CondicionIVAReceptorId>5<\/CondicionIVAReceptorId>/);
});

test('turns a rejected invoice into ArcaRejectedError with ARCA codes', async () => {
  const ticket = { token: 'T', sign: 'S', expiresAt: new Date(NOW.getTime() + 3_600_000) };
  const rejected = soap(
    '<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp>' +
      '<FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10016</Code><Msg>Numero de comprobante invalido</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp>' +
      '</FECAESolicitarResult></FECAESolicitarResponse>'
  );
  const { client } = harness(ticket, routeByAction({ FECAESolicitar: rejected }));

  await assert.rejects(
    client.requestCae({ number: 38, total: 100, issueDate: NOW }),
    (error: unknown) => error instanceof ArcaRejectedError && error.codes.includes('10016')
  );
});

test('a transport failure is ArcaUnavailableError so the caller can retry', async () => {
  const ticket = { token: 'T', sign: 'S', expiresAt: new Date(NOW.getTime() + 3_600_000) };
  const { client } = harness(ticket, () => new Error('socket hang up'));

  await assert.rejects(client.requestCae({ number: 38, total: 100, issueDate: NOW }), ArcaUnavailableError);
});

test('consult returns the authorized invoice, or null when ARCA has none', async () => {
  const ticket = { token: 'T', sign: 'S', expiresAt: new Date(NOW.getTime() + 3_600_000) };
  const found = soap(
    '<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult><ResultGet>' +
      '<CbteDesde>38</CbteDesde><CbteFch>20261121</CbteFch><ImpTotal>20900</ImpTotal><CodAutorizacion>86473873429798</CodAutorizacion><FchVto>20261201</FchVto>' +
      '</ResultGet></FECompConsultarResult></FECompConsultarResponse>'
  );
  const missing = soap(
    '<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult><Errors><Err><Code>602</Code><Msg>No existe</Msg></Err></Errors></FECompConsultarResult></FECompConsultarResponse>'
  );

  assert.deepEqual(await harness(ticket, routeByAction({ FECompConsultar: found })).client.consult(38), {
    number: 38,
    cae: '86473873429798',
    caeExpiresAt: '2026-12-01',
    total: 20900,
    issueDate: '2026-11-21',
  });
  assert.equal(await harness(ticket, routeByAction({ FECompConsultar: missing })).client.consult(38), null);
});

const arcaErrors = (operation: string, code: string, message: string) =>
  soap(
    `<${operation}Response xmlns="http://ar.gov.afip.dif.FEV1/"><${operation}Result>` +
      `<Errors><Err><Code>${code}</Code><Msg>${message}</Msg></Err></Errors></${operation}Result></${operation}Response>`
  );

test('internal ARCA errors (5xx) are retryable, not a refusal of the invoice', async () => {
  const ticket = { token: 'T', sign: 'S', expiresAt: new Date(NOW.getTime() + 3_600_000) };

  for (const code of ['500', '501', '502', '503']) {
    const last = harness(ticket, routeByAction({ FECompUltimoAutorizado: arcaErrors('FECompUltimoAutorizado', code, 'Error interno') })).client;
    await assert.rejects(last.lastAuthorized(), ArcaUnavailableError, `lastAuthorized ${code}`);

    const cae = harness(ticket, routeByAction({ FECAESolicitar: arcaErrors('FECAESolicitar', code, 'Error interno') })).client;
    await assert.rejects(cae.requestCae({ number: 1, total: 100, issueDate: NOW }), ArcaUnavailableError, `requestCae ${code}`);
  }
});

test('an invalid token (600) is retryable and drops the stored ticket so the next call logs in again', async () => {
  const ticket = { token: 'BAD', sign: 'S', expiresAt: new Date(NOW.getTime() + 3_600_000) };
  const { client, store } = harness(
    ticket,
    routeByAction({ FECompUltimoAutorizado: arcaErrors('FECompUltimoAutorizado', '600', 'ValidacionDeToken: No validaron las fechas de expiracion') })
  );

  await assert.rejects(client.lastAuthorized(), ArcaUnavailableError);

  assert.equal(store.cleared, 1);
});

test('a real refusal keeps the stored ticket', async () => {
  const ticket = { token: 'T', sign: 'S', expiresAt: new Date(NOW.getTime() + 3_600_000) };
  const { client, store } = harness(ticket, routeByAction({ FECAESolicitar: arcaErrors('FECAESolicitar', '10015', 'Factura C no puede discriminar IVA') }));

  await assert.rejects(client.requestCae({ number: 1, total: 100, issueDate: NOW }), ArcaRejectedError);

  assert.equal(store.cleared, 0);
});

test('asks for a Nota de Crédito C associated to its invoice, with its own numbering', async () => {
  const ticket = { token: 'T', sign: 'S', expiresAt: new Date('2026-11-22T06:00:00Z') };
  const { client, requests } = harness(
    ticket,
    routeByAction({ FECompUltimoAutorizado: lastResponse(0), FECAESolicitar: approved })
  );
  await client.lastAuthorized('credit_note');
  await client.requestCae({
    number: 38,
    total: 20900,
    issueDate: NOW,
    credits: { pointOfSale: 2, number: 6, issueDate: new Date('2026-11-20T18:00:00Z') },
  });

  assert.match(requests[0].body, /<CbteTipo>13<\/CbteTipo>/);
  assert.match(requests[1].body, /<FeCabReq>.*<CbteTipo>13<\/CbteTipo><\/FeCabReq>/);
  assert.match(
    requests[1].body,
    /<\/CondicionIVAReceptorId><CbtesAsoc><CbteAsoc><Tipo>11<\/Tipo><PtoVta>2<\/PtoVta><Nro>6<\/Nro><Cuit>27346513670<\/Cuit><CbteFch>20261120<\/CbteFch><\/CbteAsoc><\/CbtesAsoc>/
  );
});

test('reads the invoice a stored credit note is associated to', async () => {
  const ticket = { token: 'T', sign: 'S', expiresAt: new Date('2026-11-22T06:00:00Z') };
  const found = soap(
    '<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult><ResultGet>' +
      '<CbteDesde>1</CbteDesde><CbteFch>20261121</CbteFch><ImpTotal>20900</ImpTotal><CodAutorizacion>8</CodAutorizacion><FchVto>20261201</FchVto>' +
      '<CbtesAsoc><CbteAsoc><Tipo>11</Tipo><PtoVta>2</PtoVta><Nro>6</Nro></CbteAsoc></CbtesAsoc>' +
      '</ResultGet></FECompConsultarResult></FECompConsultarResponse>'
  );
  const { client, requests } = harness(ticket, routeByAction({ FECompConsultar: found }));

  assert.deepEqual((await client.consult(1, 'credit_note'))?.credits, { pointOfSale: 2, number: 6 });
  assert.match(requests[0].body, /<CbteTipo>13<\/CbteTipo>/);
});
