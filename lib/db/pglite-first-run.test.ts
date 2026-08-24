// The FIRST server in a fresh worktree must leave an owner lock behind.
//
// This is the case the whole single-writer guard exists for, and the one it is
// least able to cover: claimPgliteLock cannot write into a data directory that
// does not exist yet, so the claim is only completed once PGlite has made it.
// PGlite makes it inside the async init its constructor kicks off — NOT in the
// constructor — so recording the owner on the line after `new PGlite(...)`
// records nothing at all, and the second server is waved straight through to
// diverge silently.
//
// The fake below reproduces exactly that contract: the directory appears when
// `waitReady` resolves, and never before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCK_FILE } from './pglite-lock';

vi.mock('@electric-sql/pglite', () => ({
  PGlite: class FakePGlite {
    readonly waitReady: Promise<void>;
    constructor(dataDir: string) {
      // Deferred by a turn of the event loop, like the real emscripten NODEFS
      // init: anything that reads the directory synchronously after the
      // constructor sees nothing there.
      this.waitReady = new Promise<void>((resolve) => {
        setTimeout(() => { mkdirSync(dataDir, { recursive: true }); resolve(); }, 0);
      });
    }
    async close(): Promise<void> {}
  },
}));
vi.mock('drizzle-orm/pglite', () => ({ drizzle: () => ({}) }));

let root: string;
let dataDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bbg-pglite-first-run-'));
  // Deliberately absent: a worktree that has never run a dev server.
  dataDir = join(root, '.pglite');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('PGLITE_PATH', dataDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('opening PGlite in a worktree that has never run one', () => {
  it('leaves an owner lock naming this process', async () => {
    // Arrange
    expect(existsSync(dataDir)).toBe(false);
    const { getDb, closeDb } = await import('./index');

    // Act
    await getDb();

    // Assert — without this the next dev server reads no owner and opens the
    // same single-writer database alongside us.
    expect(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).toBe(String(process.pid));
    await closeDb();
  });
});
