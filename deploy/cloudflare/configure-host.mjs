/* eslint-disable no-console -- a CLI script: its output is the deploy log */
// Points wrangler.jsonc at the hostname chosen in the GitHub environment, so going
// live (or moving hosts) is a variable change, not a code change.
//   ACADEMY_HOSTNAME        canonical host, e.g. academy.mlopsmena.com
//   ACADEMY_REDIRECT_HOSTS  optional, comma-separated hosts that 301 to the canonical one
//   SENTRY_ENVIRONMENT      optional, e.g. production
// With no ACADEMY_HOSTNAME the file is left as committed (staging).
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('./wrangler.jsonc', import.meta.url);
const host = process.env.ACADEMY_HOSTNAME?.trim();
if (!host) {
  console.log('ACADEMY_HOSTNAME not set: deploying wrangler.jsonc as committed');
  process.exit(0);
}
const valid = (h) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h);
const aliases = (process.env.ACADEMY_REDIRECT_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter((h) => h && h !== host);
for (const h of [host, ...aliases]) if (!valid(h)) throw new Error(`Invalid hostname: ${h}`);

let text = readFileSync(file, 'utf8');
const committed = text.match(/"ACADEMY_HOSTNAME": "([^"]+)"/)?.[1];
if (!committed) throw new Error('ACADEMY_HOSTNAME not found in wrangler.jsonc');
text = text.replaceAll(committed, host);
const routes = [host, ...aliases].map((pattern) => ({ pattern, custom_domain: true }));
text = text.replace(/"routes": \[[^\]]*\]/, `"routes": ${JSON.stringify(routes)}`);
const sentryEnv = process.env.SENTRY_ENVIRONMENT?.trim();
if (sentryEnv) text = text.replace(/"SENTRY_ENVIRONMENT": "[^"]*"/, `"SENTRY_ENVIRONMENT": ${JSON.stringify(sentryEnv)}`);
writeFileSync(file, text);
console.log(`Hostname: ${host}${aliases.length ? `; redirecting ${aliases.join(', ')}` : ''}`);
