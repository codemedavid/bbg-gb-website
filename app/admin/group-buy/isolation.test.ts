// The Group Buy section is meant to stand on its own.
//
// The client asked for the campaign workflow to be kept apart from Hatian and
// from Product Management. That is an architectural promise, and architectural
// promises decay quietly: the next person to need a field here reaches for the
// nearest hatian helper and nothing goes red. So the boundary is asserted
// against the source itself.
//
// The one crossing that IS allowed is reading the product catalog to tick which
// products a campaign includes. That is a read of shared data, not a share of
// the workflow — this section cannot create, edit or archive a product.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sectionDir = fileURLToPath(new URL('.', import.meta.url));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    // Test files talk about the boundary; only shipped code is bound by it.
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });

const files = sourceFiles(sectionDir);
const read = (path: string) => readFileSync(path, 'utf8');
const relative = (path: string) => path.slice(sectionDir.length);

// Everything the section may pull out of the shared admin API. Anything else is
// a workflow reaching into another workflow.
const ALLOWED_ADMIN_API = ['useCampaigns', 'useCampaign', 'useMutate', 'useAdminProducts'];

// Mutations that belong to Hatian or Product Management.
const FOREIGN_MUTATIONS = [
  'saveGroupBuy', 'deleteGroupBuy', 'useAdminGroupBuys', 'useAdminGroupBuyCommitments',
  'saveProduct', 'archiveProduct', 'saveMoqProduct', 'deleteMoqProduct', 'useAdminMoqProducts',
];

it('has source files to check', () => {
  expect(files.length).toBeGreaterThan(0);
});

describe('isolation from Hatian', () => {
  it('imports nothing from the hatian screens or helpers', () => {
    for (const file of files) {
      const src = read(file);
      expect(src, `${relative(file)} imports from the hatian screens`).not.toMatch(/from ['"].*admin\/groupbuys/);
      expect(src, `${relative(file)} imports the kahati helpers`).not.toMatch(/from ['"]@\/lib\/kahati['"]/);
    }
  });
});

describe('isolation from Product Management', () => {
  it('imports nothing from the product screens', () => {
    for (const file of files) {
      expect(read(file), `${relative(file)} imports from the product screens`)
        .not.toMatch(/from ['"].*admin\/(products|moq-products)/);
    }
  });

  it('never calls a product or hatian mutation', () => {
    for (const file of files) {
      const src = read(file);
      for (const fn of FOREIGN_MUTATIONS) {
        expect(src, `${relative(file)} uses ${fn}, which belongs to another workflow`)
          .not.toMatch(new RegExp(`\\b${fn}\\b`));
      }
    }
  });
});

describe('what it does take from the shared admin API', () => {
  it('takes only campaign hooks and the read-only product catalog', () => {
    for (const file of files) {
      const imported = read(file).match(/import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/admin-api['"]/);
      if (!imported) continue;
      const names = imported[1].split(',').map((n) => n.trim()).filter(Boolean);
      for (const name of names) {
        expect(ALLOWED_ADMIN_API, `${relative(file)} imports ${name} from the shared admin API`)
          .toContain(name);
      }
    }
  });
});
