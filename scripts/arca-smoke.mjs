// Smoke test de solo lectura contra la HOMOLOGACIÓN de ARCA (no emite comprobantes).
// Uso: ARCA_CERT_PATH=... ARCA_KEY_PATH=... ARCA_CUIT=... ARCA_TICKET_FILE=... node scripts/arca-smoke.mjs [ptoVta ...]
// Requiere `npm run build`. No imprime claves ni tokens.
import fs from 'node:fs';
import { createArcaClient } from '../dist/services/invoicing/client.js';
import { createHttpsTransport } from '../dist/services/invoicing/transport.js';

const { ARCA_CERT_PATH, ARCA_KEY_PATH, ARCA_CUIT, ARCA_TICKET_FILE } = process.env;
if (!ARCA_CERT_PATH || !ARCA_KEY_PATH || !ARCA_CUIT || !ARCA_TICKET_FILE) {
  console.error('Faltan ARCA_CERT_PATH, ARCA_KEY_PATH, ARCA_CUIT o ARCA_TICKET_FILE');
  process.exit(1);
}

const ticketStore = {
  load: async () => {
    if (!fs.existsSync(ARCA_TICKET_FILE)) return null;
    const stored = JSON.parse(fs.readFileSync(ARCA_TICKET_FILE, 'utf8'));
    return { ...stored, expiresAt: new Date(stored.expiresAt) };
  },
  save: async (ticket) => fs.writeFileSync(ARCA_TICKET_FILE, JSON.stringify(ticket), { mode: 0o600 }),
};

const pointsOfSale = process.argv.slice(2).map(Number);
for (const pointOfSale of pointsOfSale.length ? pointsOfSale : [1, 2, 3, 4, 5]) {
  const client = createArcaClient({
    config: {
      cuit: ARCA_CUIT,
      pointOfSale,
      environment: process.env.ARCA_ENV === 'production' ? 'production' : 'homologation',
      certificatePem: fs.readFileSync(ARCA_CERT_PATH, 'utf8'),
      privateKeyPem: fs.readFileSync(ARCA_KEY_PATH, 'utf8'),
    },
    transport: createHttpsTransport(),
    ticketStore,
  });
  try {
    const last = await client.lastAuthorized();
    console.log(`PtoVta ${pointOfSale}: último Factura C autorizado = ${last}`);
    if (process.env.ARCA_EMIT === '1') {
      const result = await client.requestCae({ number: last + 1, total: 1, issueDate: new Date() });
      console.log(`  EMITIDA (homologación): nro ${result.number}, CAE ${result.cae}, vto ${result.caeExpiresAt}`);
      break;
    }
  } catch (error) {
    console.log(`PtoVta ${pointOfSale}: ${error.name}: ${error.message}`);
  }
}
