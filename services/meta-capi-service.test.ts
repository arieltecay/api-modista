import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import axios from 'axios';
import { sendMetaConversionEvent } from './meta-capi-service.js';
import MetaEventDlq from '../models/MetaEventDlq.js';

test('sends the SHA-256 browser session UUID as external_id', async () => {
  const previousPixelId = process.env.META_PIXEL_ID;
  const previousAccessToken = process.env.META_CAPI_ACCESS_TOKEN;
  const previousLegacyAccessToken = process.env.META_ACCESS_TOKEN;
  const previousPost = axios.post;
  const previousFindOneAndUpdate = MetaEventDlq.findOneAndUpdate;
  const previousUpdateOne = MetaEventDlq.updateOne;
  const sessionId = 'dcbdf4d8-40f3-46d9-bd7c-915ab926e455';
  const expectedExternalId = crypto.createHash('sha256').update(sessionId).digest('hex');
  let persistedEvent: { eventId?: string; eventTime?: number } | undefined;
  let sentPayload: {
    data: Array<{
      user_data: { external_id?: string };
      custom_data: { order_id?: string };
      event_time: number;
    }>;
  } | undefined;

  process.env.META_PIXEL_ID = 'test-pixel';
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
  delete process.env.META_ACCESS_TOKEN;
  MetaEventDlq.findOneAndUpdate = (async (_filter, update) => {
    const setOnInsert = (update as {
      $setOnInsert?: { payload?: typeof persistedEvent; directSendClaim?: string };
    }).$setOnInsert;
    persistedEvent = setOnInsert?.payload;
    return { _id: 'queued-event', directSendClaim: setOnInsert?.directSendClaim };
  }) as typeof MetaEventDlq.findOneAndUpdate;
  MetaEventDlq.updateOne = (async () => ({ acknowledged: true })) as unknown as typeof MetaEventDlq.updateOne;
  axios.post = (async (_url, payload) => {
    sentPayload = payload as typeof sentPayload;
    return { data: { fbtrace_id: 'test-trace' } };
  }) as typeof axios.post;

  try {
    const result = await sendMetaConversionEvent({
      eventName: 'Purchase',
      marketingConsent: true,
      eventId: 'purchase_test',
      orderId: 'mp_123',
      eventTime: 1_795_000_000,
      externalId: sessionId,
    });

    assert.deepEqual(result, {
      accepted: true,
      delivered: true,
      eventId: 'purchase_test',
    });
    assert.equal(sentPayload?.data[0].user_data.external_id, expectedExternalId);
    assert.equal(sentPayload?.data[0].custom_data.order_id, 'mp_123');
    assert.equal(sentPayload?.data[0].event_time, 1_795_000_000);
    assert.deepEqual(persistedEvent, {
      eventName: 'Purchase',
      marketingConsent: true,
      eventId: 'purchase_test',
      orderId: 'mp_123',
      eventTime: 1_795_000_000,
      externalId: sessionId,
    });
  } finally {
    axios.post = previousPost;
    MetaEventDlq.findOneAndUpdate = previousFindOneAndUpdate;
    MetaEventDlq.updateOne = previousUpdateOne;
    if (previousPixelId === undefined) delete process.env.META_PIXEL_ID;
    else process.env.META_PIXEL_ID = previousPixelId;
    if (previousAccessToken === undefined) delete process.env.META_CAPI_ACCESS_TOKEN;
    else process.env.META_CAPI_ACCESS_TOKEN = previousAccessToken;
    if (previousLegacyAccessToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = previousLegacyAccessToken;
  }
});

test('accepts a conversion durably when Meta direct delivery fails', async () => {
  const previousPixelId = process.env.META_PIXEL_ID;
  const previousAccessToken = process.env.META_CAPI_ACCESS_TOKEN;
  const previousPost = axios.post;
  const previousFindOneAndUpdate = MetaEventDlq.findOneAndUpdate;
  const previousUpdateOne = MetaEventDlq.updateOne;
  let queuedBeforePost = false;

  process.env.META_PIXEL_ID = 'test-pixel';
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
  MetaEventDlq.findOneAndUpdate = (async (_filter, update) => {
    queuedBeforePost = true;
    const setOnInsert = (update as { $setOnInsert?: { directSendClaim?: string } }).$setOnInsert;
    return { _id: 'queued-event', directSendClaim: setOnInsert?.directSendClaim };
  }) as typeof MetaEventDlq.findOneAndUpdate;
  MetaEventDlq.updateOne = (async () => ({ acknowledged: true })) as unknown as typeof MetaEventDlq.updateOne;
  axios.post = (async () => {
    assert.equal(queuedBeforePost, true);
    throw new Error('Meta timeout');
  }) as typeof axios.post;

  try {
    const result = await sendMetaConversionEvent({
      eventName: 'Lead',
      marketingConsent: true,
      eventId: 'lead_test',
      externalId: 'session-test',
    });

    assert.deepEqual(result, {
      accepted: true,
      delivered: false,
      eventId: 'lead_test',
    });
  } finally {
    axios.post = previousPost;
    MetaEventDlq.findOneAndUpdate = previousFindOneAndUpdate;
    MetaEventDlq.updateOne = previousUpdateOne;
    if (previousPixelId === undefined) delete process.env.META_PIXEL_ID;
    else process.env.META_PIXEL_ID = previousPixelId;
    if (previousAccessToken === undefined) delete process.env.META_CAPI_ACCESS_TOKEN;
    else process.env.META_CAPI_ACCESS_TOKEN = previousAccessToken;
  }
});

test('only the request that creates an outbox event sends it directly', async () => {
  const previousPost = axios.post;
  const previousFindOneAndUpdate = MetaEventDlq.findOneAndUpdate;
  let directSendAttempted = false;

  MetaEventDlq.findOneAndUpdate = (async () => ({
    _id: 'existing-event',
    status: 'pending',
    directSendClaim: 'claimed-by-another-request',
  })) as typeof MetaEventDlq.findOneAndUpdate;
  axios.post = (async () => {
    directSendAttempted = true;
    return { data: { fbtrace_id: 'unexpected' } };
  }) as typeof axios.post;

  try {
    const result = await sendMetaConversionEvent({
      eventName: 'Lead',
      marketingConsent: true,
      eventId: 'lead_concurrent',
      externalId: 'session-test',
    });

    assert.deepEqual(result, {
      accepted: true,
      delivered: false,
      eventId: 'lead_concurrent',
    });
    assert.equal(directSendAttempted, false);
  } finally {
    axios.post = previousPost;
    MetaEventDlq.findOneAndUpdate = previousFindOneAndUpdate;
  }
});
