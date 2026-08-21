// Stops a second dev server from silently sharing the local PGlite database.
//
// PGlite is single-writer. Two `next dev` processes in the same worktree both
// open ./.pglite, diverge, and answer different things for the same request —
// one served a product list while the other 500'd on the very same query. The
// symptom reaches the admin as "Something went wrong.", so the cause looks like
// application code rather than two servers.
//
// PGlite's own postmaster.pid is no help: it records `-42`, a WASM placeholder,
// not an OS pid. Hence an explicit lock of our own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeLockConflict, claimPgliteLock, LOCK_FILE } from './pglite-lock';

describe('describeLockConflict', () => {
  const ownPid = 4242;

  it('allows a directory nobody has claimed', () => {
    expect(describeLockConflict({ recordedPid: null, ownPid, isRecordedPidAlive: false })).toBeNull();
  });

  it('allows this process to re-open its own database', () => {
    // getDb() memoises, but a dev server that hot-reloads the module would
    // otherwise lock itself out of its own data.
    expect(describeLockConflict({ recordedPid: ownPid, ownPid, isRecordedPidAlive: true })).toBeNull();
  });

  it('allows taking over a lock whose owner has exited', () => {
    expect(describeLockConflict({ recordedPid: 999, ownPid, isRecordedPidAlive: false })).toBeNull();
  });

  it('refuses when another live process already holds the database', () => {
    const problem = describeLockConflict({ recordedPid: 50306, ownPid, isRecordedPidAlive: true });

    expect(problem).not.toBeNull();
  });

  it('names the process holding it, so the developer can find it', () => {
    const problem = describeLockConflict({ recordedPid: 50306, ownPid, isRecordedPidAlive: true });

    expect(problem).toContain('50306');
  });

  it('explains that PGlite is single-writer rather than just saying "locked"', () => {
    const problem = describeLockConflict({ recordedPid: 50306, ownPid, isRecordedPidAlive: true });

    expect(problem).toContain('single-writer');
  });
});

describe('claimPgliteLock', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pglite-lock-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('records this process as the owner of a fresh directory', () => {
    claimPgliteLock(dir);

    expect(readFileSync(join(dir, LOCK_FILE), 'utf8').trim()).toBe(String(process.pid));
  });

  it('is safe to call twice from the same process', () => {
    claimPgliteLock(dir);

    expect(() => claimPgliteLock(dir)).not.toThrow();
  });

  it('throws when a different live process holds the directory', () => {
    // process.ppid is alive and is not us — a real foreign owner, no mocking.
    writeFileSync(join(dir, LOCK_FILE), String(process.ppid));

    expect(() => claimPgliteLock(dir)).toThrow(/single-writer/);
  });

  it('takes over a lock left behind by a process that no longer exists', () => {
    writeFileSync(join(dir, LOCK_FILE), '999999');

    expect(() => claimPgliteLock(dir)).not.toThrow();
    expect(readFileSync(join(dir, LOCK_FILE), 'utf8').trim()).toBe(String(process.pid));
  });

  it('ignores a corrupt lock rather than wedging the developer out', () => {
    writeFileSync(join(dir, LOCK_FILE), 'not-a-pid');

    expect(() => claimPgliteLock(dir)).not.toThrow();
  });

  it('does nothing for an in-memory database, which has no directory to share', () => {
    // The whole test suite runs on memory://, and each file gets its own
    // instance — locking those against each other would deadlock the suite.
    expect(() => claimPgliteLock('memory://')).not.toThrow();
    expect(existsSync(join('memory://', LOCK_FILE))).toBe(false);
  });
});
