/* eslint-disable no-console -- a CLI script: its output is the deploy log */
// Prepares wrangler.jsonc for one deploy target and applies the hostname chosen in that
// target's GitHub environment, so moving hosts is a variable change, not a code change.
//
//   node configure-host.mjs <production|staging>
//
//   ACADEMY_HOSTNAME        optional canonical host (default: the one committed for the target)
//   ACADEMY_REDIRECT_HOSTS  optional, comma-separated hosts that 301 to the canonical one
//   SENTRY_ENVIRONMENT      optional, e.g. production
//   EMAIL_ALLOWLIST         staging only, optional: comma-separated addresses or "@domain"
//                           entries that receive their own staging email (testers)
//   EMAIL_REDIRECT_TO       staging only, optional: where everyone else's staging email goes
//   SHA                     optional, the commit being deployed (names the web build)
//
// Writes host, url and bucket to $GITHUB_OUTPUT for the later steps. Refuses to let one
// environment claim the other's hostname, and refuses a staging config that would share
// production's Worker name or bucket, or that has no email redirect.
// Rewrites wrangler.jsonc as plain JSON (comments dropped): meant for CI checkouts.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const target = process.argv[2];
if (target !== 'production' && target !== 'staging') {
  console.error('Usage: node configure-host.mjs <production|staging>');
  process.exit(2);
}

const file = new URL('./wrangler.jsonc', import.meta.url);
const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(file, 'utf8'));
if (error || !config) throw new Error(`Cannot parse wrangler.jsonc: ${ts.flattenDiagnosticMessageText(error?.messageText, ' ')}`);

const production = config;
const staging = config.env?.staging;
if (!staging) throw new Error('env.staging is missing from wrangler.jsonc');
const block = target === 'production' ? production : staging;
const other = target === 'production' ? staging : production;

const valid = (h) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h);
const host = process.env.ACADEMY_HOSTNAME?.trim() || block.vars.ACADEMY_HOSTNAME;
const aliases = (process.env.ACADEMY_REDIRECT_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter((h) => h && h !== host);
for (const h of [host, ...aliases]) if (!valid(h)) throw new Error(`Invalid hostname: ${h}`);

const othersHosts = new Set([other.vars.ACADEMY_HOSTNAME, ...(other.routes ?? []).map((r) => r.pattern)]);
for (const h of [host, ...aliases]) {
  if (othersHosts.has(h)) throw new Error(`${h} belongs to the other environment; ${target} must not claim it`);
}
if (target === 'staging') {
  if (!staging.name || staging.name === production.name) throw new Error('staging must deploy its own Worker');
  if (staging.vars.S3_BUCKET === production.vars.S3_BUCKET) throw new Error('staging must use its own bucket');
  if (!staging.vars.EMAIL_REDIRECT_TO) throw new Error('staging must set EMAIL_REDIRECT_TO');
}

block.vars.ACADEMY_HOSTNAME = host;
block.routes = [host, ...aliases].map((pattern) => ({ pattern, custom_domain: true }));
const web = block.containers.find((c) => c.class_name === 'WebContainer');
web.image_vars = { ...web.image_vars, NEXT_PUBLIC_SITE_URL: `https://${host}` };
// The commit being deployed names the web build (Next's deploymentId), so pages and assets
// of different builds can tell each other apart while a rollout replaces the containers.
const sha = process.env.SHA?.trim();
if (sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`Invalid SHA: ${sha}`);
  web.image_vars.NEXT_DEPLOYMENT_ID = sha.slice(0, 12);
}
if (target === 'staging') {
  // Testers listed here get their own staging email; everyone else's is redirected.
  const isEntry = (e) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e) || /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(e);
  const allow = process.env.EMAIL_ALLOWLIST?.trim();
  if (allow) {
    const entries = allow.split(',').map((e) => e.trim()).filter(Boolean);
    const bad = entries.filter((e) => !isEntry(e));
    if (bad.length) throw new Error(`EMAIL_ALLOWLIST has invalid entries: ${bad.join(', ')}`);
    block.vars.EMAIL_ALLOWLIST = entries.join(',');
  }
  const redirect = process.env.EMAIL_REDIRECT_TO?.trim();
  if (redirect) {
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(redirect)) throw new Error('EMAIL_REDIRECT_TO must be one email address');
    block.vars.EMAIL_REDIRECT_TO = redirect;
  }
  console.log(`staging email: allowlist ${block.vars.EMAIL_ALLOWLIST ? block.vars.EMAIL_ALLOWLIST.split(',').length + ' entries' : 'empty'}; others go to ${block.vars.EMAIL_REDIRECT_TO}`);
}
const sentryEnv = process.env.SENTRY_ENVIRONMENT?.trim();
if (sentryEnv) block.vars.SENTRY_ENVIRONMENT = sentryEnv;

writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `host=${host}\nurl=https://${host}\nbucket=${block.vars.S3_BUCKET}\n`);
}
console.log(`${target}: ${block.name} on ${host}${aliases.length ? `; redirecting ${aliases.join(', ')}` : ''}`);
