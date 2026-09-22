import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '../..');

// Repo root .env, then apps/api/.env overrides (telephony keys live here).
config({ path: resolve(repoRoot, '.env') });
config({ path: resolve(pkgRoot, '.env'), override: true });
