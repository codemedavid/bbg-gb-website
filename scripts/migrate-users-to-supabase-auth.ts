// Mirrors public.users into Supabase Auth's auth.users — Phase 1 of the move to
// Supabase-managed authentication.
//
//   npx tsx scripts/migrate-users-to-supabase-auth.ts            # dry run (default)
//   npx tsx scripts/migrate-users-to-supabase-auth.ts --apply    # actually writes
//
// Additive and idempotent: it only ever CREATES auth.users rows, never touches
// public.users, and skips anything already migrated. Re-running after a partial
// failure picks up where it stopped, so a half-finished run is safe.
//
// Each account is created under its EXISTING id and its EXISTING bcrypt hash.
// That is the whole trick: orders.user_id and every other foreign key point at
// public.users.id, so reusing the id keeps all history attached, and reusing the
// hash means nobody's password changes and nobody has to be told anything.
//
// The decision rules live in lib/auth-migration.ts and are unit-tested; this
// file is only the I/O around them.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getDb, users } from '../lib/db';
import { planUserMigration, type AppUser, type AuthUserRef } from '../lib/auth-migration';

const APPLY = process.argv.includes('--apply');

// Supabase caps a listUsers page at 1000; ask for the maximum so 250 accounts
// come back in a single round trip.
const PAGE_SIZE = 1000;

function requireEnv(name: string): string {
  const value = (process.env[name] || '').trim();
  if (!value) {
    console.error(`✗ ${name} is not set. This script needs it to know which project to write to.`);
    process.exit(1);
  }
  return value;
}

async function loadAppUsers(): Promise<AppUser[]> {
  const db = await getDb();
  const rows = await db.select({
    id: users.id, email: users.email, passwordHash: users.passwordHash,
    name: users.name, phone: users.phone, role: users.role,
  }).from(users);
  return rows as AppUser[];
}

async function loadAuthUsers(
  admin: ReturnType<typeof createClient>['auth']['admin'],
): Promise<AuthUserRef[]> {
  const found: AuthUserRef[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`listUsers failed on page ${page}: ${error.message}`);
    for (const u of data.users) found.push({ id: u.id, email: u.email ?? '' });
    if (data.users.length < PAGE_SIZE) return found;
  }
}

async function main(): Promise<void> {
  // Read side and write side are configured separately, so a mismatched pair
  // (local database, production auth) is possible and would be a catastrophe.
  // Both get printed before anything is written so the operator can see them.
  const databaseUrl = requireEnv('DATABASE_URL');
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_KEY');

  const dbHost = new URL(databaseUrl.replace(/^postgres(ql)?:\/\//, 'https://')).host;
  console.log(`  reading  public.users from  ${dbHost}`);
  console.log(`  writing  auth.users   to    ${new URL(supabaseUrl).host}`);
  console.log(`  mode     ${APPLY ? 'APPLY — this writes' : 'dry run (pass --apply to write)'}\n`);

  const supa = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const [appUsers, authUsers] = await Promise.all([loadAppUsers(), loadAuthUsers(supa.auth.admin)]);
  console.log(`  public.users: ${appUsers.length}    auth.users already present: ${authUsers.length}`);

  const plan = planUserMigration(appUsers, authUsers);
  console.log(`  to create: ${plan.toCreate.length}    already migrated: ${plan.alreadyMigrated.length}    conflicts: ${plan.conflicts.length}\n`);

  for (const { user, reason } of plan.conflicts) {
    console.error(`  ✗ ${user.email} (${user.id}) — ${reason}`);
  }

  if (!APPLY) {
    console.log('\n  Dry run only. Nothing was written. Re-run with --apply to create these accounts.');
    // Conflicts are worth a non-zero exit even in a dry run: it is the signal a
    // CI step or a careful operator should stop on.
    process.exit(plan.conflicts.length ? 1 : 0);
  }

  let created = 0;
  const failures: { user: AppUser; message: string }[] = [];

  // Sequential on purpose. 250 accounts take a few seconds, and Supabase's admin
  // API rate-limits bursts — a parallel run would trade a clear progress line
  // for partial failures that are harder to reason about on a re-run.
  for (const user of plan.toCreate) {
    const { error } = await supa.auth.admin.createUser({
      id: user.id,
      email: user.email,
      password_hash: user.passwordHash,
      // Without this the account lands unconfirmed and cannot sign in — these
      // customers confirmed their address by ordering, months ago.
      email_confirm: true,
      // app_metadata is service-role-only and lands in the access token, which
      // is how requireAdmin() stays a zero-query check after the cutover.
      // user_metadata would be self-editable and must never hold the role.
      app_metadata: { role: user.role },
      user_metadata: { name: user.name, ...(user.phone ? { phone: user.phone } : {}) },
    });
    if (error) {
      failures.push({ user, message: error.message });
      console.error(`  ✗ ${user.email} — ${error.message}`);
      continue;
    }
    created += 1;
    if (created % 25 === 0) console.log(`  … ${created}/${plan.toCreate.length}`);
  }

  console.log(`\n  created ${created}    failed ${failures.length}    skipped ${plan.alreadyMigrated.length}`);
  if (failures.length || plan.conflicts.length) {
    console.error('\n  Finished with problems. Fix the rows above and re-run — already-created accounts are skipped.');
    process.exit(1);
  }
  console.log('  All accounts mirrored. public.users is untouched and still authoritative for login.');
}

main().catch((err) => {
  console.error('[migrate-users-to-supabase-auth]', err);
  process.exit(1);
});
