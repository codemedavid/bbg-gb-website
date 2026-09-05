// Deciding what to do with each account before anything is written to
// auth.users. Split from the script for the same reason lib/db/check-outcome.ts
// is split from scripts/check-schema.ts: the rules are worth testing, the
// network calls are not.
//
// The one rule that matters more than the others: an app user is only ever
// migrated under its EXISTING id. Every order, settlement and reset token in the
// database points at public.users.id, so an auth.users row minted with a fresh
// uuid would silently orphan that customer's whole history.
import { describe, it, expect } from 'vitest';
import { planUserMigration, type AppUser, type AuthUserRef } from './auth-migration';

// A real bcryptjs cost-10 hash. All 250 production rows are exactly this shape —
// `$2a$10$` plus 53 chars, 60 total — and the planner rejects anything else.
const REAL_HASH = '$2a$10$UMJBdcQ3eaxmEepnWpF08uXSZZlvFi4Be/GIS2.VwQCtwkuSesRh6';

const user = (over: Partial<AppUser> = {}): AppUser => ({
  id: '11111111-1111-1111-1111-111111111111',
  email: 'ana@example.com',
  passwordHash: REAL_HASH,
  name: 'Ana Cruz',
  phone: null,
  role: 'customer',
  ...over,
});

describe('planUserMigration', () => {
  it('queues an untouched account for creation', () => {
    const plan = planUserMigration([user()], []);

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].email).toBe('ana@example.com');
    expect(plan.alreadyMigrated).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('skips an account already carrying the same id in auth.users, so a re-run is a no-op', () => {
    const u = user();
    const existing: AuthUserRef[] = [{ id: u.id, email: u.email }];

    const plan = planUserMigration([u], existing);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.alreadyMigrated).toHaveLength(1);
  });

  it('treats the id as authoritative, not the address — a changed email still counts as migrated', () => {
    const u = user({ email: 'ana.new@example.com' });
    const existing: AuthUserRef[] = [{ id: u.id, email: 'ana.old@example.com' }];

    const plan = planUserMigration([u], existing);

    expect(plan.alreadyMigrated).toHaveLength(1);
    expect(plan.toCreate).toHaveLength(0);
  });

  it('refuses an address already held by a DIFFERENT auth id rather than orphaning the history', () => {
    const u = user();
    const existing: AuthUserRef[] = [
      { id: '99999999-9999-9999-9999-999999999999', email: 'ana@example.com' },
    ];

    const plan = planUserMigration([u], existing);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].reason).toMatch(/different/i);
  });

  it('matches addresses case-insensitively — auth.users lowercases, our table does not', () => {
    const u = user({ email: 'Ana@Example.COM' });
    const existing: AuthUserRef[] = [{ id: u.id, email: 'ana@example.com' }];

    const plan = planUserMigration([u], existing);

    expect(plan.alreadyMigrated).toHaveLength(1);
  });

  it('normalises the address it will hand to auth.users', () => {
    const plan = planUserMigration([user({ email: '  Ana@Example.COM ' })], []);

    expect(plan.toCreate[0].email).toBe('ana@example.com');
  });

  it('flags two app accounts that collapse to one address instead of creating one at random', () => {
    const a = user({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'dup@example.com' });
    const b = user({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', email: 'DUP@example.com' });

    const plan = planUserMigration([a, b], []);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(2);
    expect(plan.conflicts[0].reason).toMatch(/shares/i);
  });

  it('rejects an account with no usable bcrypt hash rather than creating a passwordless login', () => {
    const plan = planUserMigration([user({ passwordHash: '' })], []);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.conflicts[0].reason).toMatch(/password/i);
  });

  it('rejects a truncated hash — it would migrate as an account nobody can sign into', () => {
    const plan = planUserMigration([user({ passwordHash: '$2a$10$tooshort' })], []);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.conflicts[0].reason).toMatch(/password/i);
  });

  it('accepts every bcrypt variant the table could hold', () => {
    for (const prefix of ['$2a$10$', '$2b$10$', '$2y$12$']) {
      const hash = prefix + 'UMJBdcQ3eaxmEepnWpF08uXSZZlvFi4Be/GIS2.VwQCtwkuSesRh6'.slice(0, 53);
      const plan = planUserMigration([user({ passwordHash: hash })], []);
      expect(plan.toCreate, `${prefix} should be accepted`).toHaveLength(1);
    }
  });

  it('carries the role through, since the access token reads it from app_metadata', () => {
    const plan = planUserMigration([user({ role: 'admin' })], []);

    expect(plan.toCreate[0].role).toBe('admin');
  });

  it('plans every account in one pass', () => {
    const migrated = user({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'a@example.com' });
    const fresh = user({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', email: 'b@example.com' });
    const taken = user({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', email: 'c@example.com' });

    const plan = planUserMigration([migrated, fresh, taken], [
      { id: migrated.id, email: migrated.email },
      { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', email: 'c@example.com' },
    ]);

    expect(plan.alreadyMigrated.map((u) => u.id)).toEqual([migrated.id]);
    expect(plan.toCreate.map((u) => u.id)).toEqual([fresh.id]);
    expect(plan.conflicts.map((c) => c.user.id)).toEqual([taken.id]);
  });
});
