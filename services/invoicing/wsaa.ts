import { ArcaUnavailableError } from './errors.js';
import { asNode, parseXml, soapBody, soapEnvelope, text } from './soap.js';
import type { ArcaTicket } from './types.js';

const TEN_MINUTES = 600_000;

/** `loginTicketRequest` for the `wsfe` service, valid for a window around `now`. */
export const buildLoginTicketRequest = (now: Date): string =>
  `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>` +
  `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
  `<generationTime>${new Date(now.getTime() - TEN_MINUTES).toISOString()}</generationTime>` +
  `<expirationTime>${new Date(now.getTime() + TEN_MINUTES).toISOString()}</expirationTime>` +
  `</header><service>wsfe</service></loginTicketRequest>`;

export const buildLoginSoap = (cmsBase64: string): string =>
  soapEnvelope(`<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><in0>${cmsBase64}</in0></loginCms>`);

export const parseLoginResponse = (xml: string): ArcaTicket => {
  const returned = text(asNode(soapBody(xml).loginCmsResponse).loginCmsReturn);
  const ticket = asNode(parseXml(returned ?? '').loginTicketResponse);
  const credentials = asNode(ticket.credentials);
  const token = text(credentials.token);
  const sign = text(credentials.sign);
  const expiration = text(asNode(ticket.header).expirationTime);

  if (!token || !sign || !expiration || Number.isNaN(Date.parse(expiration))) {
    throw new ArcaUnavailableError('Respuesta de WSAA sin credenciales válidas');
  }
  return { token, sign, expiresAt: new Date(expiration) };
};
