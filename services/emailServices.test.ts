import assert from 'node:assert/strict';
import test from 'node:test';
import { isEmailDeliverySimulated } from './emailServices.js';

test('file mode is not provider acceptance, including in production', () => {
  const previousMode = process.env.EMAIL_MODE;
  const previousEnvironment = process.env.NODE_ENV;
  try {
    process.env.EMAIL_MODE = 'file';
    process.env.NODE_ENV = 'production';
    assert.equal(isEmailDeliverySimulated(), true);
    process.env.EMAIL_MODE = 'smtp';
    assert.equal(isEmailDeliverySimulated(), false);
  } finally {
    if (previousMode === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = previousMode;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});
