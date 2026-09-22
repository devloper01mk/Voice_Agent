import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '../..');

// Repo root .env, then apps/api/.env (Nexora + telephony), then optional agent-v2/.env.
// override:true so file values win over a stale shell/Cursor-exported token (Postman OK, agent 401).
config({ path: resolve(repoRoot, '.env') });
config({ path: resolve(repoRoot, 'apps/api/.env'), override: true });
config({ path: resolve(pkgRoot, '.env'), override: true });

const nexoraUrl =
  process.env.NEXORA_FACTS_QUERY_URL?.trim() || process.env.NEXORA_HOTEL_FACTS_URL?.trim() || '';
const nexoraToken = process.env.NEXORA_INGEST_TOKEN?.trim() || '';
if (nexoraUrl && nexoraToken) {
  console.info(
    `[vsa] Nexora facts configured — urlHost=${safeHost(nexoraUrl)} token=${nexoraToken.slice(0, 14)}…${nexoraToken.slice(-4)}`,
  );
} else {
  console.warn('[vsa] Nexora facts NOT configured (missing NEXORA_FACTS_QUERY_URL or NEXORA_INGEST_TOKEN)');
}

function safeHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/[^/]+$/, '/…')}`;
  } catch {
    return '(invalid-url)';
  }
}
