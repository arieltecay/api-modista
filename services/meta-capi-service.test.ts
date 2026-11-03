import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import axios from 'axios';
import { sendMetaConversionEvent } from './meta-capi-service.js';

test('sends the SHA-256 browser session UUID as external_id', async () => {
  const previousPixelId = process.env.META_PIXEL_ID;
  const previousAccessToken = process.env.META_CAPI_ACCESS_TOKEN;
  const previousLegacyAccessToken = process.env.META_ACCESS_TOKEN;
  const previousPost = axios.post;
  const sessionId = 'dcbdf4d8-40f3-46d9-bd7c-915ab926e455';
  const expectedExternalId = crypto.createHash('sha256').update(sessionId).digest('hex');
  let sentPayload: { data: Array<{ user_data: { external_id?: string } }> } | undefined;

  process.env.META_PIXEL_ID = 'test-pixel';
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
  delete process.env.META_ACCESS_TOKEN;
  axios.post = (async (_url, payload) => {
    sentPayload = payload as typeof sentPayload;
    return { data: { fbtrace_id: 'test-trace' } };
  }) as typeof axios.post;

  try {
    const sent = await sendMetaConversionEvent({
      eventName: 'Purchase',
      eventId: 'purchase_test',
      externalId: sessionId,
    });

    assert.equal(sent, true);
    assert.equal(sentPayload?.data[0].user_data.external_id, expectedExternalId);
  } finally {
    axios.post = previousPost;
    if (previousPixelId === undefined) delete process.env.META_PIXEL_ID;
    else process.env.META_PIXEL_ID = previousPixelId;
    if (previousAccessToken === undefined) delete process.env.META_CAPI_ACCESS_TOKEN;
    else process.env.META_CAPI_ACCESS_TOKEN = previousAccessToken;
    if (previousLegacyAccessToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = previousLegacyAccessToken;
  }
});
