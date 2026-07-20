import 'dotenv/config';
import { resolveStorageDriver } from './storage-driver';

// Whitespace/newlines are never valid unencoded in a connection URL, but they
// sneak in when the value is pasted into a dashboard with a line wrap — strip
// them so a bad paste can't produce ERR_INVALID_URL in production.
const sanitizeUrl = (value: string | undefined): string => (value || '').replace(/\s+/g, '');

export const env = {
  // Empty => local embedded Postgres (PGlite) for dev/verification.
  databaseUrl: sanitizeUrl(process.env.DATABASE_URL),
  // Where PGlite persists when databaseUrl is empty. Tests use 'memory://'.
  pglitePath: process.env.PGLITE_PATH || './.pglite',
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  // Storage/admin operations reuse the same project URL as the client. Fall back to
  // NEXT_PUBLIC_SUPABASE_URL so only the (server-only) service key must be set separately.
  supabaseUrl: sanitizeUrl(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  // ImageKit.io (STORAGE_DRIVER=imagekit). Public key + URL endpoint are safe to
  // expose; the private key is server-only and used for uploads + signed URLs.
  imagekitPublicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
  imagekitPrivateKey: process.env.IMAGEKIT_PRIVATE_KEY || '',
  imagekitUrlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || '',
  storageDriver: resolveStorageDriver({
    explicit: process.env.STORAGE_DRIVER,
    hasImageKit: !!(process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT),
    hasSupabase: !!(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_KEY
    ),
  }),
  // PostHog receives an event per order status; a destination there sends the
  // customer email. Unset = capture is skipped (valid local/dev state).
  posthogKey: process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY || '',
  posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  mailFrom: process.env.MAIL_FROM || 'BBG Peptides <noreply@bbgpeptides.ph>',
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  isProd: process.env.NODE_ENV === 'production',
};

export const BUCKETS = { proofs: 'payment-proofs', coa: 'coa-files', qr: 'payment-qr', moq: 'moq-images' } as const;

// Root folder in ImageKit that namespaces every file this website uploads, so the
// dashboard clearly separates BBG groupbuy assets from other sites in the account.
export const IMAGEKIT_ROOT = 'bbg-groupbuy';
