// Planning the move of public.users into Supabase Auth's auth.users.
//
// Pure on purpose — scripts/migrate-users-to-supabase-auth.ts does the network
// calls, this decides what those calls should be. Same split as
// lib/db/check-outcome.ts and scripts/check-schema.ts.
//
// The invariant the whole migration rests on: an account keeps its EXISTING id.
// orders.user_id, settlements, order_status_history and password_reset_tokens
// all reference public.users.id, so an auth.users row minted with a fresh uuid
// would leave the customer's entire history pointing at nobody. Supabase's admin
// createUser accepts both `id` and a bcrypt `password_hash`, so the row can be
// mirrored exactly and nobody's password changes.

export type AppUser = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone: string | null;
  role: 'customer' | 'admin';
};

/** The subset of an existing auth.users row this planner needs. */
export type AuthUserRef = { id: string; email: string };

export type MigrationConflict = { user: AppUser; reason: string };

export type MigrationPlan = {
  /** Safe to create, with the address already normalised. */
  toCreate: AppUser[];
  /** Already present in auth.users under the same id — a re-run skips these. */
  alreadyMigrated: AppUser[];
  /** Needs a human. Never guessed at. */
  conflicts: MigrationConflict[];
};

// auth.users stores addresses lowercased; public.users does not normalise on the
// way in. Comparing raw would migrate "Ana@Example.com" a second time.
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

// Every hash in this table came from bcryptjs at cost 10. Supabase accepts
// bcrypt, but only if it actually looks like one — an empty or truncated hash
// would create an account nobody can sign into, which is worse than not
// migrating it, because it looks migrated.
const BCRYPT = /^\$2[aby]\$\d{2}\$.{53}$/;

export function planUserMigration(appUsers: AppUser[], existing: AuthUserRef[]): MigrationPlan {
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const existingByEmail = new Map(existing.map((e) => [normalizeEmail(e.email), e]));

  // Two app rows whose addresses differ only by case cannot both exist in
  // auth.users. Creating whichever one came first would decide, silently, which
  // customer keeps their login.
  const seen = new Map<string, number>();
  for (const u of appUsers) {
    const key = normalizeEmail(u.email);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const plan: MigrationPlan = { toCreate: [], alreadyMigrated: [], conflicts: [] };

  for (const u of appUsers) {
    const email = normalizeEmail(u.email);

    // Checked first: an account already migrated is settled, whatever else is
    // true of it. Its address may since have changed in public.users.
    if (existingById.has(u.id)) {
      plan.alreadyMigrated.push(u);
      continue;
    }
    if ((seen.get(email) ?? 0) > 1) {
      plan.conflicts.push({ user: u, reason: `shares the address ${email} with another account` });
      continue;
    }
    const holder = existingByEmail.get(email);
    if (holder) {
      plan.conflicts.push({
        user: u,
        reason: `${email} is already held by a different auth user (${holder.id})`,
      });
      continue;
    }
    if (!BCRYPT.test(u.passwordHash)) {
      plan.conflicts.push({ user: u, reason: 'password hash is missing or not bcrypt' });
      continue;
    }
    plan.toCreate.push({ ...u, email });
  }

  return plan;
}
