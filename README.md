# BBG Peptides

Group-buy e-commerce for research peptides (Philippines). Solo Buy + **Kahati** (shared MOQ) ordering,
bank-transfer checkout with payment-proof upload, order tracking, peptide reconstitution calculator,
COA downloads, email notifications, and an admin dashboard with weekly/monthly analytics.

## Stack
- **Frontend** — React + Vite + Tailwind (mobile-first storefront + desktop admin), TanStack Query, Zustand
- **Backend** — Node + Express + Drizzle ORM, Zod validation, JWT (httpOnly cookie) auth
- **Database** — PostgreSQL (Supabase)
- **Storage** — Supabase Storage (payment proofs + COA files); local disk in dev
- **Email** — Nodemailer (SMTP in prod; console/DB log in dev)
- **Deploy** — Vercel (static client + Express serverless function)

## Local development
1. `cd server && cp .env.example .env` and fill in Supabase `DATABASE_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`, and a `JWT_SECRET`. Set `STORAGE_DRIVER=local` to store uploads on disk,
   or `supabase` to use Storage buckets.
2. From the repo root: `npm install` (root tooling) then `npm --prefix server install && npm --prefix client install`.
3. Push the schema and seed data: `npm run db:setup`.
4. `npm run dev` — client on http://localhost:5173, API on http://localhost:4000.

### Demo logins (after seeding)
- Customer: `ana@example.com` / `password123`
- Admin: `admin@bbgpeptides.ph` / `password123` → visit `/admin`

## Scripts (root)
- `npm run dev` — run client + server together
- `npm run db:setup` — push schema + seed
- `npm run build` — build the client
- `npm test` — server unit tests (pricing + calculator)

## Deploy to Vercel
1. Push to a Git repo and import into Vercel.
2. Set env vars (see `.env.example`) including `STORAGE_DRIVER=supabase` and `CLIENT_ORIGIN=<your prod URL>`.
3. Deploy. `vercel.json` builds the client to `client/dist` and serves the Express app from `api/`.

## Business rules
- **Solo Buy** — min 10 kits + 10 BAC water; ₱180 LBC shipping; processed immediately.
- **Kahati** — min 7 vials/participant; ₱150 repack fee (shipping incl.); per-vial = kit ÷ 10.
- **Arrival** — white powder ships first; salt forms, Bioglutide, TR blends, colored & liquid
  blends (incl. NAD+) arrive 3–5 days later (flagged per product/group-buy).
- **Order flow** — Proof under review → Payment confirmed → Batch filling → Shipped → Delivered.
