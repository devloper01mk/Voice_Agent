/**
 * Large Product Knowledge: chunk the Brain for search, keep only a short catalog
 * map in the live prompt, and let the agent fetch details via search_product_knowledge.
 */

/** Above this, the prompt carries a catalog map instead of the full Brain. */
export const PRODUCT_KNOWLEDGE_INLINE_CHARS = 3_000;
export const PRODUCT_KNOWLEDGE_CATALOG_MAP_CHARS = 1_500;
export const PRODUCT_KNOWLEDGE_SEARCH_TOOL = 'search_product_knowledge';

const CHUNK_TARGET_CHARS = 700;
const CHUNK_MAX_CHARS = 1_100;

export interface ProductKnowledgeChunkInput {
  heading: string;
  content: string;
}

export interface ProductKnowledgeHit {
  heading: string;
  content: string;
  score: number;
}

export function isLargeProductKnowledge(text?: string | null): boolean {
  return (text?.trim().length ?? 0) > PRODUCT_KNOWLEDGE_INLINE_CHARS;
}

const HEADING_RE = /^(#{1,4})\s+(.+?)\s*#*\s*$/;

function splitLongBlock(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  const pieces: string[] = [];
  let cur = '';
  const units = block.split(/\n/).flatMap((line) =>
    line.length <= maxChars ? [line] : line.split(/(?<=[.!?।])\s+/),
  );
  for (const unit of units) {
    const u = unit.length > maxChars ? unit.slice(0, maxChars) : unit;
    if (cur && cur.length + 1 + u.length > maxChars) {
      pieces.push(cur);
      cur = u;
    } else {
      cur = cur ? `${cur}\n${u}` : u;
    }
  }
  if (cur.trim()) pieces.push(cur);
  return pieces;
}

/**
 * Split Brain markdown into heading-scoped chunks (~700 chars). Each chunk keeps its
 * heading path so a hit like "Cancellation" still says which property/plan it belongs to.
 */
export function chunkProductKnowledge(
  markdown: string,
  opts?: { targetChars?: number; maxChars?: number },
): ProductKnowledgeChunkInput[] {
  const target = opts?.targetChars ?? CHUNK_TARGET_CHARS;
  const max = Math.max(target, opts?.maxChars ?? CHUNK_MAX_CHARS);
  const text = markdown.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  const sections: Array<{ heading: string; body: string[] }> = [];
  const path: string[] = [];
  let current = { heading: '', body: [] as string[] };
  for (const line of text.split('\n')) {
    const m = HEADING_RE.exec(line);
    if (m) {
      if (current.body.join('\n').trim()) sections.push(current);
      const level = m[1]!.length;
      path.length = Math.min(path.length, level - 1);
      path[level - 1] = m[2]!.trim();
      current = { heading: path.filter(Boolean).join(' > '), body: [] };
      continue;
    }
    current.body.push(line);
  }
  if (current.body.join('\n').trim()) sections.push(current);

  const chunks: ProductKnowledgeChunkInput[] = [];
  for (const section of sections) {
    const blocks = section.body
      .join('\n')
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean)
      .flatMap((b) => splitLongBlock(b, max));
    let cur = '';
    for (const block of blocks) {
      if (cur && cur.length + 2 + block.length > target) {
        chunks.push({ heading: section.heading, content: cur });
        cur = block;
      } else {
        cur = cur ? `${cur}\n\n${block}` : block;
      }
    }
    if (cur) chunks.push({ heading: section.heading, content: cur });
  }
  return chunks;
}

function truncateAtLine(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const nl = cut.lastIndexOf('\n');
  return (nl > maxChars * 0.5 ? cut.slice(0, nl) : cut).trimEnd();
}

/**
 * Short always-in-prompt overview: section outline of the Brain plus the head of the
 * summary, so the agent knows what exists and when to search.
 */
export function buildProductKnowledgeCatalogMap(
  brainMarkdown: string,
  brainSummary?: string | null,
  maxChars = PRODUCT_KNOWLEDGE_CATALOG_MAP_CHARS,
): string {
  const headings = brainMarkdown
    .split(/\r?\n/)
    .map((line) => HEADING_RE.exec(line))
    .filter((m): m is RegExpExecArray => Boolean(m) && m![1]!.length <= 3)
    .map((m) => `${'  '.repeat(Math.max(0, m[1]!.length - 1))}- ${m[2]!.trim()}`);
  const uniqueHeadings = [...new Set(headings)];
  const outlineBudget = Math.floor(maxChars * 0.45);
  const outline = truncateAtLine(uniqueHeadings.join('\n'), outlineBudget);

  const overviewSource = (brainSummary?.trim() || brainMarkdown).trim();
  const overviewBudget = Math.max(200, maxChars - outline.length - 60);
  const overview = truncateAtLine(overviewSource, overviewBudget);

  return [
    outline ? `Catalog sections:\n${outline}` : '',
    overview ? `Overview:\n${overview}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'what', 'how',
  'do', 'does', 'you', 'your', 'i', 'me', 'my', 'it', 'this', 'that', 'with', 'can', 'there',
  'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'kya', 'kitna', 'kitne', 'kaise', 'mein', 'me', 'se',
  'aur', 'bhi', 'tha', 'thi', 'ho', 'haan', 'ji', 'nahi', 'koi', 'kuch', 'batao', 'bataiye',
]);

export function tokenizeForSearch(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Keyword ranking (BM25-lite). Used alone when embeddings are unavailable and blended
 * with cosine similarity when they are.
 */
export function keywordScores(query: string, docs: string[]): number[] {
  const q = [...new Set(tokenizeForSearch(query))];
  if (q.length === 0 || docs.length === 0) return docs.map(() => 0);
  const docTokens = docs.map((d) => tokenizeForSearch(d));
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / docTokens.length || 1;
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const k1 = 1.2;
  const b = 0.75;
  const raw = docTokens.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of q) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docTokens.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * tokens.length) / avgLen));
    }
    return score;
  });
  const top = Math.max(...raw);
  return top > 0 ? raw.map((s) => s / top) : raw;
}

export function rankProductKnowledgeChunks(
  query: string,
  chunks: Array<ProductKnowledgeChunkInput & { semantic?: number | null }>,
  limit = 4,
): ProductKnowledgeHit[] {
  const kw = keywordScores(
    query,
    chunks.map((c) => `${c.heading}\n${c.content}`),
  );
  const hasSemantic = chunks.some((c) => typeof c.semantic === 'number');
  return chunks
    .map((c, i) => {
      const k = kw[i] ?? 0;
      const score =
        hasSemantic && typeof c.semantic === 'number' ? 0.75 * c.semantic + 0.25 * k : k;
      return { heading: c.heading, content: c.content, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

/** Compact tool payload — small enough that Gemini Live answers quickly. */
export function formatProductKnowledgeHits(hits: ProductKnowledgeHit[], maxChars = 1_200): string {
  let out = '';
  for (const h of hits) {
    const block = h.heading ? `[${h.heading}]\n${h.content}` : h.content;
    const next = out ? `${out}\n\n${block}` : block;
    if (next.length > maxChars) {
      if (!out) out = truncateAtLine(block, maxChars);
      break;
    }
    out = next;
  }
  return out;
}

export const PRODUCT_KNOWLEDGE_SEARCH_TOOL_DESCRIPTION =
  'Search the full Product Knowledge catalog for facts not shown in the prompt (prices, plans, features, ' +
  'policies, FAQs, locations, specs). Call it silently — no filler narration — whenever the caller asks a ' +
  'product detail you do not see in Product Knowledge. Pass a short English keyword query (e.g. ' +
  '"premium plan cancellation policy"). Answer ONLY from the returned facts in 1–2 spoken sentences. ' +
  'If found:false, say you do not have that verified detail and offer to check / callback — never guess.';
