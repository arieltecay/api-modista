import assert from 'node:assert/strict';

/** Credentials of services that send real messages (SMTP mail, WhatsApp Cloud API). */
const OUTBOUND_VARS = ['EMAIL_USER', 'EMAIL_PASS', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_WABA_ID'] as const;

/**
 * Call BEFORE importing any service. `dotenv` (loaded by the services) never overrides a variable that
 * already exists, not even an empty one, so with a real `.env` next to the tests nothing can reach a real
 * mailbox or WhatsApp number. Deleting the variables instead would let `.env` fill them back in.
 */
export const blockOutbound = (): void => {
  process.env.EMAIL_MODE = 'smtp';
  for (const name of OUTBOUND_VARS) process.env[name] = '';
};

/** Call AFTER importing the services under test: fails loudly if a real credential got through. */
export const assertOutboundBlocked = (): void => {
  for (const name of OUTBOUND_VARS) {
    assert.equal(process.env[name], '', `${name} must stay empty in tests, or they could send real messages`);
  }
};
