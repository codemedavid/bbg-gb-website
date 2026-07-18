import 'dotenv/config';

export const env = {
  // Empty => local embedded Postgres (PGlite) for dev/verification.
  databaseUrl: process.env.DATABASE_URL || '',
  // Where PGlite persists when databaseUrl is empty. Tests use 'memory://'.
  pglitePath: process.env.PGLITE_PATH || './.pglite',
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  storageDriver: (process.env.STORAGE_DRIVER || 'local') as 'local' | 'supabase',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  mailFrom: process.env.MAIL_FROM || 'BBG Peptides <noreply@bbgpeptides.ph>',
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  isProd: process.env.NODE_ENV === 'production',
};

export const BUCKETS = { proofs: 'payment-proofs', coa: 'coa-files', qr: 'payment-qr' } as const;
