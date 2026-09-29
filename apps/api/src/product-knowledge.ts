import { createHash } from 'node:crypto';
import {
  chunkProductKnowledge,
  formatProductKnowledgeHits,
  rankProductKnowledgeChunks,
  type ProductKnowledgeHit,
} from '@vsa/shared';
import { prisma } from './db.js';
import { cosineSimilarity, embedText, embedTexts, toVector } from './vector-learnings.js';

const EMBED_BATCH = 96;
/** Live calls cannot wait on a slow embedding call — fall back to keyword ranking. */
const QUERY_EMBED_TIMEOUT_MS = Number(process.env.PRODUCT_KNOWLEDGE_QUERY_EMBED_TIMEOUT_MS ?? 1_500);
const MIN_HYBRID_SCORE = Number(process.env.PRODUCT_KNOWLEDGE_MIN_SCORE ?? 0.2);
const CACHE_TTL_MS = 5 * 60_000;

type CachedChunk = { heading: string; content: string; embedding: number[] | null };
type CacheEntry = { chunks: CachedChunk[]; loadedAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<void>>();

function hashSource(markdown: string): string {
  return createHash('sha256').update(markdown.trim()).digest('hex');
}

async function embedChunks(texts: string[]): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = await embedTexts(texts.slice(i, i + EMBED_BATCH));
    // Mixed embedded/unembedded chunks would skew hybrid scores — all or nothing.
    if (!batch) return texts.map(() => null);
    out.push(...batch);
  }
  return out;
}

async function doReindex(agentId: string, markdown: string): Promise<void> {
  const sourceHash = hashSource(markdown);
  const existing = await prisma.productKnowledgeChunk.findFirst({
    where: { agentId },
    select: { sourceHash: true },
  });
  if (existing?.sourceHash === sourceHash) return;

  const chunks = chunkProductKnowledge(markdown);
  const embeddings = await embedChunks(chunks.map((c) => `${c.heading}\n${c.content}`));

  await prisma.$transaction([
    prisma.productKnowledgeChunk.deleteMany({ where: { agentId } }),
    prisma.productKnowledgeChunk.createMany({
      data: chunks.map((c, i) => ({
        agentId,
        position: i,
        heading: c.heading,
        content: c.content,
        embedding: embeddings[i] ?? undefined,
        sourceHash,
      })),
    }),
  ]);
  cache.delete(agentId);
  console.info(
    `[product-knowledge] indexed agent=${agentId} chunks=${chunks.length} embedded=${embeddings.some(Boolean)}`,
  );
}

/** Rebuild chunks when the Brain changed (no-op when the source hash matches). */
export function reindexProductKnowledge(agentId: string, markdown: string): Promise<void> {
  const running = inflight.get(agentId);
  if (running) return running.then(() => doReindex(agentId, markdown));
  const job = doReindex(agentId, markdown).finally(() => inflight.delete(agentId));
  inflight.set(agentId, job);
  return job;
}

async function loadChunks(agentId: string): Promise<CachedChunk[]> {
  const hit = cache.get(agentId);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.chunks;

  let rows = await prisma.productKnowledgeChunk.findMany({
    where: { agentId },
    orderBy: { position: 'asc' },
  });
  if (rows.length === 0) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { brainMarkdown: true },
    });
    if (!agent?.brainMarkdown.trim()) return [];
    await reindexProductKnowledge(agentId, agent.brainMarkdown);
    rows = await prisma.productKnowledgeChunk.findMany({
      where: { agentId },
      orderBy: { position: 'asc' },
    });
  }
  const chunks = rows.map((r) => {
    const vec = toVector(r.embedding);
    return { heading: r.heading, content: r.content, embedding: vec.length ? vec : null };
  });
  cache.set(agentId, { chunks, loadedAt: Date.now() });
  return chunks;
}

async function embedQueryWithTimeout(query: string): Promise<number[] | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), QUERY_EMBED_TIMEOUT_MS);
  });
  try {
    return await Promise.race([embedText(query), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ProductKnowledgeSearchResult {
  ok: true;
  found: boolean;
  facts: string;
  hits: ProductKnowledgeHit[];
  mode: 'hybrid' | 'keyword';
  latency_ms: number;
}

export async function searchProductKnowledge(
  agentId: string,
  query: string,
  limit = 4,
): Promise<ProductKnowledgeSearchResult> {
  const started = Date.now();
  const q = query.trim();
  const chunks = q ? await loadChunks(agentId) : [];
  const hasEmbeddings = chunks.some((c) => c.embedding);
  const queryVec = hasEmbeddings ? await embedQueryWithTimeout(q) : null;

  const hits = rankProductKnowledgeChunks(
    q,
    chunks.map((c) => ({
      heading: c.heading,
      content: c.content,
      semantic: queryVec && c.embedding ? cosineSimilarity(queryVec, c.embedding) : null,
    })),
    limit,
  );
  const mode = queryVec ? 'hybrid' : 'keyword';
  const relevant = mode === 'hybrid' ? hits.filter((h) => h.score >= MIN_HYBRID_SCORE) : hits;

  return {
    ok: true,
    found: relevant.length > 0,
    facts: formatProductKnowledgeHits(relevant),
    hits: relevant,
    mode,
    latency_ms: Date.now() - started,
  };
}

/** Shape returned to the voice model (both LiveKit and Acefone runtimes). */
export function productKnowledgeToolPayload(result: ProductKnowledgeSearchResult) {
  if (!result.found) {
    return {
      ok: true,
      found: false,
      rule: 'No verified detail for this in Product Knowledge. Say so briefly and offer to check or arrange a callback. Never guess.',
    };
  }
  return {
    ok: true,
    found: true,
    facts: result.facts,
    rule: 'Answer only from facts, 1–2 spoken sentences, in the call language. Do not read headings or brackets aloud.',
  };
}
