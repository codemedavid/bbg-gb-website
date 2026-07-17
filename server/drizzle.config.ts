import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

export default defineConfig(
  url
    ? { schema: './src/db/schema.ts', out: './src/db/migrations', dialect: 'postgresql', dbCredentials: { url }, verbose: true, strict: true }
    : { schema: './src/db/schema.ts', out: './src/db/migrations', dialect: 'postgresql', driver: 'pglite', dbCredentials: { url: './.pglite' } }
);
