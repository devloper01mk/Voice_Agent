import type { llm as LlmModule } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { resolveCallLlm } from '@vsa/shared';
import type { RuntimeAgent } from './load-agent.js';

/** Simulator 2.0 uses the Agent Studio LLM (GPT or Groq). */
export function createLlm(agent: RuntimeAgent): LlmModule.LLM {
  const llm = resolveCallLlm(agent);
  if (llm.provider === 'gpt') {
    return new openai.LLM({
      model: llm.model,
      temperature: 0.4,
      maxCompletionTokens: 800,
    });
  }
  return openai.LLM.withGroq({
    model: llm.model,
    temperature: 0.4,
  });
}
