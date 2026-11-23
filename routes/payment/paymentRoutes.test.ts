import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { startTestServer, type TestServer } from '../../utils/testing/httpServer.js';

let stopDb: () => Promise<void>;
let server: TestServer;

before(async () => {
  stopDb = await startTestDb();
  const { default: paymentRoutes } = await import('./paymentRoutes.js');
  server = await startTestServer((app) => app.use('/api/payment', paymentRoutes));
});
after(async () => {
  await server.close();
  await stopDb();
});

test('creating payment preferences is rate limited per client, so reservations cannot be renewed in bulk', async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 14; attempt += 1) {
    statuses.push((await server.post('/api/payment/create-preference', { inscriptionId: 'not-an-id' })).status);
  }

  assert.equal(statuses[0], 400);
  assert.ok(statuses.includes(429), 'expected a 429 within 14 attempts');
  assert.equal(statuses.indexOf(429), 10, 'the eleventh attempt in the window is refused');
});
