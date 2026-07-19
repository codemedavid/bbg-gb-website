-- BBG Groupbuy — RLS lockdown for Supabase.
-- Enables Row Level Security on every table in the public schema and revokes all
-- privileges from the public API roles (anon, authenticated). With RLS enabled and
-- NO policies defined, those roles get zero rows — the tables become invisible to
-- anyone holding only the publishable/anon key.
--
-- This does NOT affect the app: it connects server-side as the 'postgres' role via
-- DATABASE_URL, which BYPASSES RLS entirely. Supabase's service_role also bypasses it.
-- Safe to run before or after the data seed. Idempotent — re-running is a no-op.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated;', t);
    END IF;
  END LOOP;
END $$;
