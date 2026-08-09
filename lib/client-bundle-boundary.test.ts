// No client component may reach server-only code, however indirectly.
//
// This exists because the suite lied. vitest.config.ts aliases `server-only` to
// a stub so route handlers can be tested in-process — which also means a client
// component importing a server module passes every test and then fails
// `next build` with "You're importing a component that needs server-only".
//
// That is what happened: ProofUploader wanted one constant, MAX_PROOFS, and
// imported it from lib/proof.ts — which imports ApiError from lib/session.ts,
// which is server-only. 1814 tests green, production build broken.
//
// A static walk rather than a runtime import: the point is the module GRAPH the
// bundler sees, and the stub means running the code proves nothing.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['app', 'components', 'lib'];

/** Every .ts/.tsx file under the source dirs, tests excluded. */
function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Does this file opt into the browser bundle? */
const isClientComponent = (rel: string): boolean =>
  /^\s*(['"])use client\1/.test(read(rel));

/** Does this file pull in the server-only marker directly? */
const importsServerOnly = (rel: string): boolean =>
  /(^|\n)\s*import\s+['"]server-only['"]/.test(read(rel));

/**
 * The `@/…` imports of a file, resolved to repo-relative source paths.
 *
 * Only project imports are followed. A package from node_modules cannot be the
 * thing that drags `server-only` in — that marker is ours.
 */
function projectImports(rel: string): string[] {
  const source = read(rel);
  const specifiers = [...source.matchAll(/from\s+['"](@\/[^'"]+)['"]/g)].map((m) => m[1]);
  return specifiers.flatMap((spec) => {
    const base = spec.replace(/^@\//, '');
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (fs.existsSync(path.join(ROOT, candidate))) return [candidate];
    }
    return [];
  });
}

/**
 * Walk out from a client component and return the first path that ends at a
 * server-only module, or null.
 *
 * Returns the whole chain rather than just the offending file: "lib/session.ts
 * is server-only" is not actionable on its own, and the fix is almost always to
 * break one specific link in the middle.
 */
function serverOnlyPath(entry: string): string[] | null {
  const seen = new Set<string>();
  const queue: string[][] = [[entry]];
  while (queue.length) {
    const chain = queue.shift()!;
    const current = chain[chain.length - 1];
    if (seen.has(current)) continue;
    seen.add(current);
    if (current !== entry && importsServerOnly(current)) return chain;
    for (const next of projectImports(current)) queue.push([...chain, next]);
  }
  return null;
}

const clientComponents = SOURCE_DIRS.flatMap(sourceFiles).filter(isClientComponent);

describe('client bundle boundary', () => {
  it('finds the client components to check', () => {
    // A guard on the guard: if the scan silently matched nothing — a renamed
    // directory, a changed directive — this whole file would pass while
    // checking absolutely nothing.
    expect(clientComponents.length).toBeGreaterThan(10);
  });

  it('never reaches server-only code from a client component', () => {
    const offenders = clientComponents
      .map((file) => ({ file, chain: serverOnlyPath(file) }))
      .filter((r) => r.chain !== null)
      .map((r) => r.chain!.join('\n    → '));

    // Printed as the full chain, because that is what tells you which link to
    // cut. The fix is usually to move the shared constant into an import-free
    // module, as lib/proof-limits.ts is to lib/proof.ts.
    expect(offenders).toEqual([]);
  });
});
