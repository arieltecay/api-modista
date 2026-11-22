import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { startTestServer, type TestServer } from '../../utils/testing/httpServer.js';

let server: TestServer;
let runs = 0;
const originalSecret = process.env.CRON_SECRET;

before(async () => {
  const { createInvoicesCronRouter } = await import('./cron.js');
  server = await startTestServer((app) =>
    app.use(
      '/api/cron/invoices',
      createInvoicesCronRouter(async () => {
        runs += 1;
        return { processed: 2, authorized: 1, failed: 0, stillPending: 1 };
      })
    )
  );
});
after(async () => {
  await server.close();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

test('refuses to run when CRON_SECRET is not configured', async () => {
  delete process.env.CRON_SECRET;

  assert.equal((await server.get('/api/cron/invoices', { authorization: 'Bearer anything' })).status, 503);
  assert.equal(runs, 0);
});

test('refuses a missing or wrong secret', async () => {
  process.env.CRON_SECRET = 's3cret';

  assert.equal((await server.get('/api/cron/invoices')).status, 401);
  assert.equal((await server.get('/api/cron/invoices', { authorization: 'Bearer nope' })).status, 401);
  assert.equal(runs, 0);
});

test('runs the retry job and reports its summary when the secret matches', async () => {
  process.env.CRON_SECRET = 's3cret';

  const response = await server.get('/api/cron/invoices', { authorization: 'Bearer s3cret' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, processed: 2, authorized: 1, failed: 0, stillPending: 1 });
  assert.equal(runs, 1);
});
