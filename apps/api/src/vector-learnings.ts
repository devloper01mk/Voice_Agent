import {
  inferLearningCategoriesFromText,
  normalizeGlobalCategory,
  parseLearningCategoryFromBullet,
  type GlobalLearningCategory,
} from '@vsa/shared';
import { prisma } from './db.js';

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const MIN_SCORE = Number(process.env.LEARNING_VECTOR_MIN_SCORE ?? 0.3);
const CATEGORY_BOOST = Number(process.env.LEARNING_VECTOR_CATEGORY_BOOST ?? 0.08);
const CONFIDENCE_WEIGHT = Number(process.env.LEARNING_VECTOR_CONFIDENCE_WEIGHT ?? 0.2);
const TOP_K = Number(process.env.LEARNING_VECTOR_TOP_K ?? 5);
const CANDIDATE_POOL = Number(process.env.LEARNING_VECTOR_CANDIDATE_POOL ?? 500);
const MAX_PER_CATEGORY = Number(process.env.LEARNING_VECTOR_MAX_PER_CATEGORY ?? 2);

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

interface RankedLearning {
  id: string;
  content: string;
  kind: string;
  score: number;
}

type FeedbackSignal = 'success' | 'failure';

const CONFIDENCE_MIN = 0.1;
const CONFIDENCE_MAX = 0.95;
const SUCCESS_DELTA = 0.08;
const FAILURE_DELTA = 0.1;
const OUTCOME_SUCCESS_DELTA = 0.05;
const OUTCOME_FAILURE_DELTA = 0.07;

function toVector(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((v) => Number.isFinite(v));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  if (magA === 0 || magB === 0) return -1;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function scoreLearning(
  baseScore: number,
  kind: string,
  confidenceScore: number,
  hintCategories: Set<GlobalLearningCategory>,
): number {
  let score = baseScore;
  const normalizedKind = normalizeGlobalCategory(kind);
  const confidence = Number.isFinite(confidenceScore) ? confidenceScore : 0.5;
  const confidenceLift = (confidence - 0.5) * 2 * CONFIDENCE_WEIGHT;
  score += confidenceLift;
  if (hintCategories.has(normalizedKind)) {
    score += CATEGORY_BOOST;
  }
  if (
    (normalizedKind === 'gap' || normalizedKind === 'pricing') &&
    !hintCategories.has(normalizedKind)
  ) {
    score *= 0.55;
  }
  return score;
}

function selectWithDiversity(ranked: RankedLearning[], limit: number): RankedLearning[] {
  const picked: RankedLearning[] = [];
  const perKind = new Map<string, number>();

  for (const item of ranked) {
    if (picked.length >= limit) break;
    if (picked.some((p) => p.content === item.content)) continue;

    const count = perKind.get(item.kind) ?? 0;
    if (count >= MAX_PER_CATEGORY) continue;

    picked.push(item);
    perKind.set(item.kind, count + 1);
  }

  return picked;
}

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenAIEmbeddingResponse;
    const embedding = data.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch (err) {
    console.warn(
      '[learnings] embedText failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function storeGlobalLearningVector(opts: {
  agentId: string;
  callId?: string | null;
  kind: string;
  content: string;
  confidenceScore?: number;
}): Promise<void> {
  const embedding = await embedText(opts.content);
  if (!embedding) return;
  await prisma.globalLearningVector.create({
    data: {
      agentId: opts.agentId,
      callId: opts.callId ?? null,
      kind: opts.kind,
      content: opts.content,
      embedding,
      confidenceScore:
        typeof opts.confidenceScore === 'number'
          ? Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, opts.confidenceScore))
          : 0.5,
    },
  });
}

export async function retrieveGlobalLearnings(
  agentId: string,
  query: string,
  limit = TOP_K,
): Promise<string[]> {
  const hintCategories = new Set(inferLearningCategoriesFromText(query));

  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) {
    const recent = await prisma.globalLearningVector.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return recent.map((r) => r.content);
  }

  const candidates = await prisma.globalLearningVector.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: CANDIDATE_POOL,
  });

  if (candidates.length === 0) return [];

  const ranked = candidates
    .map((c) => {
      const base = cosineSimilarity(queryEmbedding, toVector(c.embedding));
      return {
        id: c.id,
        content: c.content,
        kind: c.kind,
        score: scoreLearning(base, c.kind, c.confidenceScore, hintCategories),
      };
    })
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  const picked = selectWithDiversity(ranked, limit);
  if (picked.length > 0) {
    await markLearningUsage(picked.map((p) => p.id));
    return picked.map((r) => r.content);
  }

  // Fallback: recent learnings if nothing passes threshold
  return candidates.slice(0, Math.min(limit, 3)).map((c) => c.content);
}

export async function applyLearningFeedbackByContent(
  agentId: string,
  content: string,
  signal: FeedbackSignal,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;

  const learning = await prisma.globalLearningVector.findFirst({
    where: { agentId, content: trimmed },
    orderBy: { createdAt: 'desc' },
    select: { id: true, confidenceScore: true },
  });
  if (!learning) return;

  const delta = signal === 'success' ? SUCCESS_DELTA : -FAILURE_DELTA;
  const nextConfidence = Math.max(
    CONFIDENCE_MIN,
    Math.min(CONFIDENCE_MAX, learning.confidenceScore + delta),
  );

  await prisma.globalLearningVector.update({
    where: { id: learning.id },
    data:
      signal === 'success'
        ? {
            confidenceScore: nextConfidence,
            successCount: { increment: 1 },
          }
        : {
            confidenceScore: nextConfidence,
            failureCount: { increment: 1 },
          },
  });
}

export async function applyOutcomeFeedbackToRecentLearnings(opts: {
  agentId: string;
  signal: FeedbackSignal;
  referenceTime?: Date;
  windowMinutes?: number;
  limit?: number;
}): Promise<number> {
  const reference = opts.referenceTime ?? new Date();
  const windowMinutes = Number.isFinite(opts.windowMinutes) ? Math.max(5, opts.windowMinutes!) : 120;
  const since = new Date(reference.getTime() - windowMinutes * 60_000);
  const limit = Number.isFinite(opts.limit) ? Math.max(1, opts.limit!) : 3;
  const delta = opts.signal === 'success' ? OUTCOME_SUCCESS_DELTA : -OUTCOME_FAILURE_DELTA;

  const candidates = await prisma.globalLearningVector.findMany({
    where: {
      agentId: opts.agentId,
      lastUsedAt: { gte: since, lte: reference },
    },
    orderBy: { lastUsedAt: 'desc' },
    take: limit,
    select: { id: true, confidenceScore: true },
  });
  if (candidates.length === 0) return 0;

  await prisma.$transaction(
    candidates.map((c) => {
      const nextConfidence = Math.max(
        CONFIDENCE_MIN,
        Math.min(CONFIDENCE_MAX, c.confidenceScore + delta),
      );
      return prisma.globalLearningVector.update({
        where: { id: c.id },
        data:
          opts.signal === 'success'
            ? {
                confidenceScore: nextConfidence,
                successCount: { increment: 1 },
              }
            : {
                confidenceScore: nextConfidence,
                failureCount: { increment: 1 },
              },
      });
    }),
  );

  return candidates.length;
}

async function markLearningUsage(ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return;
  await prisma.globalLearningVector.updateMany({
    where: { id: { in: uniqueIds } },
    data: {
      usesCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

export async function countGlobalLearningVectors(agentId: string): Promise<number> {
  return prisma.globalLearningVector.count({ where: { agentId } });
}

/** One-time backfill: embed existing brainLearnings text lines into vector store. */
export async function backfillGlobalLearningsFromText(
  agentId: string,
  brainLearnings: string,
): Promise<number> {
  const lines = brainLearnings
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'));
  let added = 0;
  for (const line of lines) {
    const kind = parseLearningCategoryFromBullet(line) ?? 'other';
    await storeGlobalLearningVector({
      agentId,
      kind,
      content: line,
    });
    added += 1;
  }
  return added;
}
