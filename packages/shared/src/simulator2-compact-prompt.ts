/**
 * Cap Product Knowledge size for latency. Do **not** replace principles with an
 * intent menu — compileSystemPrompt is the shared brain.
 */
export const SIMULATOR2_PRODUCT_KNOWLEDGE_CHARS = 4_000;

export function compactSystemPrompt(
  compiledSystemPrompt: string,
  brainSummary?: string | null,
  maxProductChars = SIMULATOR2_PRODUCT_KNOWLEDGE_CHARS,
  _generalKnowledgeEnabled = true,
): string {
  const summary = brainSummary?.trim();
  const productMarker = '\n## Product Knowledge';

  if (!compiledSystemPrompt.includes(productMarker)) {
    return compiledSystemPrompt;
  }

  const productStart = compiledSystemPrompt.indexOf(productMarker);
  const afterProduct = productStart + productMarker.length;
  const rest = compiledSystemPrompt.slice(afterProduct);
  const nextHeading = rest.search(/\n## /);
  const productEnd = nextHeading >= 0 ? afterProduct + nextHeading : compiledSystemPrompt.length;

  const head = compiledSystemPrompt.slice(0, productStart);
  const embeddedProduct = compiledSystemPrompt.slice(afterProduct, productEnd).trim();
  const productBody = compactProductKnowledge(summary || embeddedProduct, maxProductChars);
  const tail = compiledSystemPrompt.slice(productEnd);

  return `${head}${productMarker}\n${productBody}${tail}`.trim();
}

/**
 * @deprecated Voice rules now live in the shared compiler. Kept so older tests
 * can import the name; returns the tail unchanged aside from trimming.
 */
export function rewriteVoiceRulesForSimulator2(voiceTail: string): string {
  return voiceTail;
}

function compactProductKnowledge(product: string, maxChars: number): string {
  const limit = Math.max(800, maxChars);
  if (product.length <= limit) return product;

  const candidate = product.slice(0, limit);
  const paragraphBreak = candidate.lastIndexOf('\n\n');
  const lineBreak = candidate.lastIndexOf('\n');
  const sentenceBreak = Math.max(
    candidate.lastIndexOf('. '),
    candidate.lastIndexOf('? '),
    candidate.lastIndexOf('! '),
  );
  const safeBreak = Math.max(paragraphBreak, lineBreak, sentenceBreak);
  const minimumUsefulBreak = Math.floor(limit * 0.65);
  const end = safeBreak >= minimumUsefulBreak ? safeBreak + 1 : limit;

  return `${candidate.slice(0, end).trimEnd()}\n[Additional catalog details omitted in low-latency mode; do not invent missing facts.]`;
}
