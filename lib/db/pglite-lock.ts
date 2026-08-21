// Single-writer guard for the local PGlite database.
//
// PGlite is one process at a time. Two `next dev` servers started in the same
// worktree both open ./.pglite, each keeps its own page cache, and they drift
// apart without ever complaining — the same request answers 200 from one and
// 500 from the other. Because lib/api-response.ts turns the resulting query
// error into a generic message, the developer sees an application bug rather
// than two servers.
//
// PGlite ships a postmaster.pid, but it records `-42` — a placeholder from the
// WASM build, not an OS pid — so it cannot say who the owner is. This keeps a
// lock of our own next to it.
//
// Advisory, not airtight: a lock can go stale between the liveness check and
// the open. It only has to beat the silent-divergence default.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = '.owner-pid';

/**
 * Marks the refusal so lib/db/db-error.ts can pass its message to the caller.
 * A plain Error would land in the api-response catch-all and come back as
 * "Something went wrong." — the dead end this guard exists to remove.
 *
 * A code rather than an ApiError because lib/session.ts pulls in next/headers,
 * and lib/db is loaded by scripts that never run inside a request.
 */
export const PGLITE_LOCKED = 'PGLITE_LOCKED';

export type LockState = {
  /** Pid recorded in the lock file; null when absent or unreadable. */
  recordedPid: number | null;
  ownPid: number;
  isRecordedPidAlive: boolean;
};

/**
 * The reason this process must not open the database, or null when it may.
 */
export function describeLockConflict({ recordedPid, ownPid, isRecordedPidAlive }: LockState): string | null {
  if (recordedPid === null) return null;
  // Our own lock. getDb() memoises, but a hot reload re-runs this module and
  // must not lock the server out of its own data.
  if (recordedPid === ownPid) return null;
  // The owner is gone — a server that exited, or was killed before it could
  // clean up. Taking the lock over is the only way to ever start again.
  if (!isRecordedPidAlive) return null;

  return `Another process (PID ${recordedPid}) already has this PGlite database open. `
    + 'PGlite is single-writer: a second reader gets its own stale copy, so the two would '
    + `silently disagree. Stop the other server (kill ${recordedPid}), or give this one its `
    + 'own database with PGLITE_PATH=/some/other/path.';
}

const isAlive = (pid: number): boolean => {
  try {
    // Signal 0 performs the permission and existence checks without delivering.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to someone else, which still counts.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
};

const readRecordedPid = (lockPath: string): number | null => {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
    // A corrupt lock blocks nobody. Refusing to start over an unreadable file
    // would be worse than the divergence this guards against.
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

/**
 * Records this process as the database's owner, or throws naming the process
 * that already is. A no-op for in-memory databases, which share nothing.
 */
export function claimPgliteLock(pglitePath: string): void {
  // Every test file gets its own memory:// instance; locking those against each
  // other would deadlock the suite.
  if (!pglitePath || pglitePath.startsWith('memory:')) return;
  if (!existsSync(pglitePath)) return; // First run — PGlite creates the directory itself.

  const lockPath = join(pglitePath, LOCK_FILE);
  // Read once: a second read could see a different owner and report liveness
  // for a pid we did not test.
  const recordedPid = readRecordedPid(lockPath);
  const problem = describeLockConflict({
    recordedPid,
    ownPid: process.pid,
    isRecordedPidAlive: recordedPid !== null && isAlive(recordedPid),
  });
  if (problem) throw Object.assign(new Error(problem), { code: PGLITE_LOCKED });

  writeFileSync(lockPath, String(process.pid));
}
