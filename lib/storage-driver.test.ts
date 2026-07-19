// Storage driver selection. The deployed site lost QR uploads because
// STORAGE_DRIVER was never set: it silently fell back to 'local', which writes to
// the serverless filesystem and fails read-only in production.
import { describe, it, expect } from 'vitest';
import { resolveStorageDriver, describeDriverProblem } from './storage-driver';

const creds = (o: Partial<Parameters<typeof resolveStorageDriver>[0]> = {}) => ({
  explicit: undefined, hasImageKit: false, hasSupabase: false, ...o,
});

describe('resolveStorageDriver', () => {
  it('honours an explicit STORAGE_DRIVER over any detected credentials', () => {
    expect(resolveStorageDriver(creds({ explicit: 'supabase', hasImageKit: true }))).toBe('supabase');
  });

  it('rejects an unknown STORAGE_DRIVER instead of silently falling back to local', () => {
    expect(() => resolveStorageDriver(creds({ explicit: 'S3' })))
      .toThrow(/STORAGE_DRIVER/);
  });

  it('auto-detects imagekit when its credentials are present and no driver is set', () => {
    expect(resolveStorageDriver(creds({ hasImageKit: true }))).toBe('imagekit');
  });

  it('auto-detects supabase when only its credentials are present', () => {
    expect(resolveStorageDriver(creds({ hasSupabase: true }))).toBe('supabase');
  });

  it('prefers imagekit when both sets of credentials are present', () => {
    expect(resolveStorageDriver(creds({ hasImageKit: true, hasSupabase: true }))).toBe('imagekit');
  });

  it('falls back to local only when nothing at all is configured', () => {
    expect(resolveStorageDriver(creds())).toBe('local');
  });

  it('ignores blank/whitespace STORAGE_DRIVER values', () => {
    expect(resolveStorageDriver(creds({ explicit: '  ', hasImageKit: true }))).toBe('imagekit');
  });

  it('accepts a driver name regardless of case or padding', () => {
    expect(resolveStorageDriver(creds({ explicit: ' ImageKit ' }))).toBe('imagekit');
  });
});

describe('describeDriverProblem', () => {
  it('flags local storage in production — the serverless filesystem is read-only', () => {
    const problem = describeDriverProblem('local', true);
    expect(problem).toMatch(/STORAGE_DRIVER/);
  });

  it('allows local storage in development', () => {
    expect(describeDriverProblem('local', false)).toBeNull();
  });

  it('allows a real driver in production', () => {
    expect(describeDriverProblem('imagekit', true)).toBeNull();
    expect(describeDriverProblem('supabase', true)).toBeNull();
  });
});
