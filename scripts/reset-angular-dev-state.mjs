import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, '..');
const staleTargets = [
  path.join(workspaceRoot, '.angular', 'vite-root'),
  path.join(workspaceRoot, '.angular', 'cache', '22.0.0', 'chore-champ', 'angular-compiler.db-lock'),
];

for (const target of staleTargets) {
  if (!existsSync(target)) {
    continue;
  }

  rmSync(target, {
    force: true,
    recursive: true,
  });
}
