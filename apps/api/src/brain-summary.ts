import type { LlmProvider } from '@vsa/shared';
import { callChatApi } from './llm-chat.js';

export interface SummarizeBrainOptions {
  productName: string;
  brainMarkdown: string;
  llmProvider: LlmProvider;
  llmModel: string;
}

const SUMMARY_SYSTEM = `You compress product documentation into a voice-sales-agent knowledge brief used on every call.

Your job:
- Preserve ALL material facts from the source. Completeness beats extreme brevity.
- MUST keep every named offering in the catalog (models, plans, SKUs, packages, variants) with starting prices when given. Never drop items from a list to save space (e.g. never keep only the first 2 of 5).
- Also preserve: key features, limits, integrations, FAQs, comparison/competitor rows, speak/number rules, and out-of-scope rules.
- Remove only repetition, filler, and marketing fluff. Merge duplicates.
- Use plain text with short section headers and bullet points (no markdown tables or heavy formatting).
- Never invent or infer facts not present in the source.
- Stay product-agnostic: follow whatever domain the source describes (cars, CRM, SaaS, etc.). Do not add unrelated categories.

Length:
- Shorter than the source is good, but NOT if it means dropping catalog items, prices, or comparison rules.
- Short source → short summary. Long source → longer summary that still covers every offering and material fact.
- When unsure, keep the fact.`;

function buildUserContent(productName: string, brainMarkdown: string): string {
  const words = brainMarkdown.trim().split(/\s+/).filter(Boolean).length;
  const chars = brainMarkdown.trim().length;
  return `Product: ${productName}
Source size: ~${words} words (${chars} characters)

Compress the FULL source below into the agent knowledge brief described in your instructions.
This is a one-time compression of the complete document — do not omit catalog entries.

Source knowledge:
${brainMarkdown}`;
}

function maxSummaryTokens(brainMarkdown: string): number {
  const words = brainMarkdown.trim().split(/\s+/).filter(Boolean).length;
  // Prefer completeness: allow long briefs for long sources; cap runaway output.
  return Math.min(8192, Math.max(800, Math.ceil(words * 0.75)));
}

export async function summarizeProductKnowledge(opts: SummarizeBrainOptions): Promise<string> {
  const userContent = buildUserContent(opts.productName, opts.brainMarkdown);
  const maxTokens = maxSummaryTokens(opts.brainMarkdown);

  if (opts.llmProvider === 'groq') {
    return callChatApi({
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: process.env.GROQ_API_KEY,
      model: opts.llmModel || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        { role: 'user', content: userContent },
      ],
      maxTokens,
      providerLabel: 'Groq',
    });
  }

  return callChatApi({
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY,
    model: opts.llmModel || process.env.OPENAI_MODEL || 'gpt-5.4-mini',
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: userContent },
    ],
    maxTokens,
    providerLabel: 'OpenAI',
  });
}
