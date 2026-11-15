import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailEnv } from './email.ts';

const ACCOUNT = '0123456789abcdef0123456789abcdef';

test('Cloudflare Email Service once both of its secrets are set, otherwise Resend', () => {
  assert.deepEqual(emailEnv({ RESEND_API_KEY: 're_1', CLOUDFLARE_EMAIL_API_TOKEN: 'cf', CLOUDFLARE_EMAIL_ACCOUNT_ID: ACCOUNT }), {
    EMAIL_PROVIDER: 'cloudflare',
    CLOUDFLARE_EMAIL_API_TOKEN: 'cf',
    CLOUDFLARE_EMAIL_ACCOUNT_ID: ACCOUNT,
  });
  assert.deepEqual(emailEnv({ RESEND_API_KEY: 're_1' }), { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_1' });
  // Half-configured or malformed: stay on Resend rather than start a container that can't send.
  assert.equal(emailEnv({ RESEND_API_KEY: 're_1', CLOUDFLARE_EMAIL_API_TOKEN: 'cf' }).EMAIL_PROVIDER, 'resend');
  assert.equal(emailEnv({ RESEND_API_KEY: 're_1', CLOUDFLARE_EMAIL_API_TOKEN: ' ', CLOUDFLARE_EMAIL_ACCOUNT_ID: ACCOUNT }).EMAIL_PROVIDER, 'resend');
  assert.equal(emailEnv({ RESEND_API_KEY: 're_1', CLOUDFLARE_EMAIL_API_TOKEN: 'cf', CLOUDFLARE_EMAIL_ACCOUNT_ID: 'not-an-id' }).EMAIL_PROVIDER, 'resend');
});
