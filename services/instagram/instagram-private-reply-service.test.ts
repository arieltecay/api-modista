import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import axios from 'axios';
import { sendInstagramPrivateReply } from './instagram-private-reply-service.js';

const previous = { token: process.env.META_INSTAGRAM_ACCESS_TOKEN, id: process.env.META_INSTAGRAM_USER_ID };
beforeEach(() => {
  process.env.META_INSTAGRAM_ACCESS_TOKEN = 'secret-token-value';
  process.env.META_INSTAGRAM_USER_ID = 'ig-business';
});
afterEach(() => {
  mock.restoreAll();
  process.env.META_INSTAGRAM_ACCESS_TOKEN = previous.token;
  process.env.META_INSTAGRAM_USER_ID = previous.id;
  if (previous.token === undefined) delete process.env.META_INSTAGRAM_ACCESS_TOKEN;
  if (previous.id === undefined) delete process.env.META_INSTAGRAM_USER_ID;
});

test('posts the comment id as recipient to the Instagram Login messages endpoint with a Bearer header', async () => {
  const post = mock.method(axios, 'post', async () => ({ data: { message_id: 'm1', recipient_id: 'r1' } }));
  const result = await sendInstagramPrivateReply('comment-1', 'Hola');
  assert.deepEqual(result, { status: 'sent' });
  const [url, body, config] = post.mock.calls[0].arguments as [string, unknown, { headers: Record<string, string> }];
  assert.match(url, /^https:\/\/graph\.instagram\.com\/v[\d.]+\/ig-business\/messages$/);
  assert.deepEqual(body, { recipient: { comment_id: 'comment-1' }, message: { text: 'Hola' } });
  assert.equal(config.headers.Authorization, 'Bearer secret-token-value');
  assert.doesNotMatch(url, /secret-token-value/);
});

test('Meta 4xx (permissions, expired window, duplicate reply) is permanent and never leaks the token', async () => {
  mock.method(axios, 'post', async () => {
    throw Object.assign(new Error('Request failed with token secret-token-value'), {
      response: { status: 400, data: { error: { message: 'No matching comment', code: 100, error_subcode: 2534014, fbtrace_id: 'trace-1' } } },
    });
  });
  const result = await sendInstagramPrivateReply('comment-1', 'Hola');
  assert.equal(result.status, 'permanent');
  assert.equal(result.status === 'permanent' && result.code, 100);
  assert.equal(result.status === 'permanent' && result.subcode, 2534014);
  assert.doesNotMatch(JSON.stringify(result), /secret-token-value/);
});

test('5xx, 429 and network failures are transient', async () => {
  for (const response of [{ status: 500 }, { status: 429 }, undefined]) {
    mock.method(axios, 'post', async () => { throw Object.assign(new Error('boom'), { response }); });
    assert.equal((await sendInstagramPrivateReply('comment-1', 'Hola')).status, 'transient');
    mock.restoreAll();
  }
});

test('missing credentials are a permanent configuration failure and call nothing', async () => {
  delete process.env.META_INSTAGRAM_ACCESS_TOKEN;
  const post = mock.method(axios, 'post', async () => ({ data: {} }));
  assert.equal((await sendInstagramPrivateReply('comment-1', 'Hola')).status, 'permanent');
  assert.equal(post.mock.callCount(), 0);
});
