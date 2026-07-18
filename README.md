# BBG Peptides

Group-buy e-commerce for research peptides (Philippines). Solo Buy + **Kahati** (shared MOQ) ordering,
bank-transfer checkout with payment-proof upload, order tracking, peptide reconstitution calculator,
COA downloads, email notifications, and an admin dashboard with weekly/monthly analytics.

## Stack
- **Framework** — Next.js 15 (App Router) + React 19 + Tailwind — mobile-first storefront + desktop admin
- **API** — Next Route Handlers (`app/api/**`), Zod validation, JWT (jose) in an httpOnly cookie
- **Data** — Drizzle ORM + PostgreSQL (Supabase). Falls back to embedded Postgres (PGlite) when `DATABASE_URL` is empty
- **Storage** — Supabase Storage (payment proofs + COA files); local disk in dev
- **Email** — Nodemailer (SMTP in prod; console + `email_log` table in dev)
- **State** — TanStack Query (server state) + Zustand (cart)
- **Deploy** — Vercel (native Next.js)

## Local development
1. `npm install`
2. Env lives in `.env` at the repo root (Next reads this automatically — there is no `server/.env`).
   Leave `DATABASE_URL` empty to run on embedded Postgres with no external setup; set it to your
   Supabase Transaction-pooler URI (plus `SUPABASE_SERVICE_KEY` and `STORAGE_DRIVER=supabase`) for real infra.
3. `npm run db:setup` — push schema + seed.
4. `npm run dev` — app on http://localhost:3000 (storefront) and /admin (dashboard).

### Demo logins (after seeding)
- Customer: `ana@example.com` / `password123`
- Admin: `admin@bbgpeptides.ph` / `password123` → visit `/admin`

## Scripts
- `npm run dev` — Next dev server (http://localhost:3000)
- `npm run db:setup` — push schema + seed
- `npm run build` — production build
- `npm test` — unit tests (pricing + calculator)

## Deploy to Vercel
1. Push to a Git repo and import into Vercel (Next.js is auto-detected — no `vercel.json` needed).
2. Set env vars: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`,
   `STORAGE_DRIVER=supabase`, plus `SMTP_*` for real email.
3. Deploy.

> `_archive_client/`, `_archive_server/`, `_archive_api/` hold the previous Vite+Express
> implementation. They are gitignored and safe to delete.

## Business rules
- **Solo Buy** — min 10 kits + 10 BAC water; ₱180 LBC shipping; processed immediately.
- **Kahati** — min 7 vials/participant and ₱150 repack fee by default; both are **admin-editable per group buy** and honoured at checkout. Per-vial = kit ÷ 10.
- **Arrival** — white powder ships first; salt forms, Bioglutide, TR blends, colored & liquid
  blends (incl. NAD+) arrive 3–5 days later (flagged per product/group-buy).
- **Order flow** — Proof under review → Payment confirmed → Batch filling → Shipped → Delivered.
# bbg-gb-website
# bbg-gb-website
# bbg-gb-website
# bbg-gb-website
