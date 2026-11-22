import https from 'node:https';
import { ArcaUnavailableError } from './errors.js';
import type { ArcaTransport } from './types.js';

const ARCA_HOST_SUFFIX = '.afip.gov.ar';
const DEFAULT_TIMEOUT_MS = 15_000;

/** ARCA's servers still use small DH parameters that OpenSSL 3 rejects at its default security level. */
const agent = new https.Agent({ ciphers: 'DEFAULT@SECLEVEL=1', keepAlive: false });

const parseArcaUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith(ARCA_HOST_SUFFIX)) {
    throw new ArcaUnavailableError('Destino fuera de ARCA rechazado');
  }
  return url;
};

/** Real HTTPS transport: only talks to `*.afip.gov.ar`. SOAP faults come as HTTP 500 and are returned for parsing. */
export const createHttpsTransport = (timeoutMs: number = DEFAULT_TIMEOUT_MS): ArcaTransport => async (request) => {
  const url = parseArcaUrl(request.url);

  return new Promise<string>((resolve, reject) => {
    const call = https.request(
      url,
      {
        method: 'POST',
        agent,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(request.body),
          SOAPAction: `"${request.soapAction}"`,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const isSoap = body.includes('Envelope');
          if (isSoap || (response.statusCode && response.statusCode < 300)) resolve(body);
          else reject(new ArcaUnavailableError(`ARCA respondió HTTP ${response.statusCode}`));
        });
      }
    );
    call.on('timeout', () => call.destroy(new Error(`timeout de ${timeoutMs} ms`)));
    call.on('error', (error) => reject(new ArcaUnavailableError(`No se pudo contactar a ARCA: ${error.message}`)));
    call.end(request.body);
  });
};
