/**
 * Which email provider the API container uses. Cloudflare Email Service once both of its
 * secrets are set on the Worker (CLOUDFLARE_EMAIL_API_TOKEN, CLOUDFLARE_EMAIL_ACCOUNT_ID),
 * otherwise Resend. Switching back is deleting the token secret (DEPLOY.md, "Email").
 */
export interface EmailSecrets {
  RESEND_API_KEY?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
  CLOUDFLARE_EMAIL_ACCOUNT_ID?: string;
}

export function emailEnv(env: EmailSecrets): Record<string, string> {
  const token = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  const account = env.CLOUDFLARE_EMAIL_ACCOUNT_ID?.trim();
  if (token && account && /^[0-9a-f]{32}$/.test(account)) {
    return { EMAIL_PROVIDER: 'cloudflare', CLOUDFLARE_EMAIL_API_TOKEN: token, CLOUDFLARE_EMAIL_ACCOUNT_ID: account };
  }
  return { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: env.RESEND_API_KEY ?? '' };
}
