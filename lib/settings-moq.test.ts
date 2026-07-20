// MOQ page visibility, stored in the `settings` table so it survives restarts.
//
// The toggle is the single source of truth for three separate gates: the
// storefront route (404 when off), the public product API, and the nav tab. It
// therefore has to fail closed — an absent or corrupt value must read as OFF,
// never as "visible", so a half-configured deploy cannot expose the page.
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, settings } from '@/lib/db';
import { resetDb } from '@/lib/test/harness';
import { getMoqPageEnabled, setMoqPageEnabled } from '@/lib/settings';

beforeEach(resetDb);

describe('MOQ page visibility setting', () => {
  it('is OFF when the key has never been written', async () => {
    expect(await getMoqPageEnabled()).toBe(false);
  });

  it('turns the page on and reports it as on', async () => {
    expect(await setMoqPageEnabled(true)).toBe(true);
    expect(await getMoqPageEnabled()).toBe(true);
  });

  it('turns the page back off', async () => {
    await setMoqPageEnabled(true);
    expect(await setMoqPageEnabled(false)).toBe(false);
    expect(await getMoqPageEnabled()).toBe(false);
  });

  it('persists the value in the database rather than in process memory', async () => {
    await setMoqPageEnabled(true);
    const db = await getDb();
    const rows = await db.select().from(settings);
    const row = rows.find((r) => r.key === 'moq_page_enabled');
    expect(row?.value).toBe('true');
  });

  it('overwrites the existing row instead of inserting a duplicate key', async () => {
    await setMoqPageEnabled(true);
    await setMoqPageEnabled(false);
    const db = await getDb();
    const rows = (await db.select().from(settings)).filter((r) => r.key === 'moq_page_enabled');
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('false');
  });

  it('fails closed: a corrupt stored value reads as OFF', async () => {
    const db = await getDb();
    await db.insert(settings).values({ key: 'moq_page_enabled', value: 'yes-please' });
    expect(await getMoqPageEnabled()).toBe(false);
  });
});
