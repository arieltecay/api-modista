import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import ArcaToken from '../../models/ArcaToken/index.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { createMongoTicketStore } from './ticketStore.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
  await ArcaToken.init();
});
after(async () => stopDb());
beforeEach(async () => {
  await ArcaToken.deleteMany({});
});

const ticket = (token: string) => ({ token, sign: 'SIGN', expiresAt: new Date('2026-11-22T06:00:00Z') });

test('loads nothing before a ticket was saved', async () => {
  assert.equal(await createMongoTicketStore('homologation', '27346513670').load(), null);
});

test('saves and loads the ticket, replacing the previous one', async () => {
  const store = createMongoTicketStore('homologation', '27346513670');

  await store.save(ticket('FIRST'));
  await store.save(ticket('SECOND'));

  assert.deepEqual(await store.load(), ticket('SECOND'));
  assert.equal(await ArcaToken.countDocuments(), 1);
});

test('keeps homologation and production tickets apart', async () => {
  await createMongoTicketStore('homologation', '27346513670').save(ticket('HOMO'));

  assert.equal(await createMongoTicketStore('production', '27346513670').load(), null);
});

test('clear forgets the ticket so the next call logs in again', async () => {
  const store = createMongoTicketStore('homologation', '27346513670');
  await store.save(ticket('BAD'));

  await store.clear?.();

  assert.equal(await store.load(), null);
});
