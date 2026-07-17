import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

export default defineConfig(
  url
    ? { schema: './lib/db/schema.ts', out: './drizzle', dialect: 'postgresql', dbCredentials: { url }, verbose: true, strict: true }
    : { schema: './lib/db/schema.ts', out: './drizzle', dialect: 'postgresql', driver: 'pglite', dbCredentials: { url: './.pglite' } }
);
