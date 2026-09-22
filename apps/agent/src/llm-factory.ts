import type { llm as LlmModule } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import type { RuntimeAgent } from './load-agent.js';

export function createLlm(agent: RuntimeAgent): LlmModule.LLM {
  if (agent.llmProvider === 'gpt') {
    return new openai.LLM({
      model: agent.llmModel || process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      temperature: 0.4,
      maxCompletionTokens: 800,
    });
  }
  return openai.LLM.withGroq({
    model:
      agent.llmModel ||
      process.env.GROQ_MODEL ||
      process.env.GROQ_FALLBACK_MODEL ||
      'llama-3.3-70b-versatile',
    temperature: 0.4,
  });
}
