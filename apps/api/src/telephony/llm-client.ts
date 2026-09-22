import {
  buildOutboundOpenerInstructions,
  buildSimulator2Instructions,
  extractNewSpokenChunks,
  mergeSkillsConfig,
  resolveCallLlm,
  trimSpokenHistoryForLlm,
  type CallDirection,
  type KnownContactProfile,
  type SkillsConfig,
} from '@vsa/shared';
import { internalApiUrl } from './internal-api.js';
import {
  createTelephonyTools,
  executeTelephonyTool,
  type TelephonyToolContext,
  type TelephonyToolDef,
} from './telephony-tools.js';

export interface RuntimeAgentPayload {
  id: string;
  name: string;
  greeting: string;
  productName: string;
  voiceId: string;
  voiceLanguages: string;
  voiceSpeed: number;
  voicePitch: number;
  ttsModel: string;
  ttsSampleRate?: number;
  ttsEmotion?: string;
  llmProvider: string;
  llmModel: string;
  sttProvider?: string;
  sttModel?: string;
  compiledSystemPrompt: string;
  agentGender?: string;
  brainSummary?: string | null;
  generalKnowledgeEnabled?: boolean;
  brainLearnings?: string | null;
  retrievedGlobalLearnings?: string | null;
  skillsConfig?: SkillsConfig | null;
  knownContact?: KnownContactProfile | null;
  openBookingSummary?: string | null;
  hasConsumedLeadHistory?: boolean;
  prospectMemory?: {
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
    factsMarkdown?: string;
    callerStyle?: string;
  } | null;
  simulatorRuntime?: {
    llmProvider?: string;
    llmModel?: string;
    studioLlmProvider?: string;
    studioLlmModel?: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
  ttftMs: number;
}

export interface LlmTextResult {
  text: string;
  usage: LlmUsage;
  hangup?: boolean;
  bookingSaved?: boolean;
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface LlmEndpoint {
  label: string;
  url: string;
  apiKey: string;
  model: string;
}

export interface StreamReplyOpts {
  signal?: AbortSignal;
  onSentence?: (sentence: string) => void;
  /** Speak a short filler line before slow tool HTTP calls. */
  onToolHold?: (toolName: string) => Promise<void>;
  promptCacheKey?: string;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
}

function sentenceEmitter(onSentence?: (sentence: string) => void) {
  let cursor = 0;
  let buffer = '';
  return {
    onDelta(content: string) {
      buffer = content;
      if (!onSentence) return;
      const next = extractNewSpokenChunks(content, cursor, false);
      cursor = next.cursor;
      for (const chunk of next.chunks) onSentence(chunk);
    },
    flush() {
      if (!onSentence) return;
      const next = extractNewSpokenChunks(buffer, cursor, true);
      cursor = next.cursor;
      for (const chunk of next.chunks) onSentence(chunk);
    },
  };
}

const MAX_SPOKEN_TOKENS = 800;

const runtimePrefetch = new Map<string, Promise<RuntimeAgentPayload>>();

export function prefetchRuntimeAgent(
  callId: string,
  agentId: string,
  opts?: {
    prospectName?: string;
    contactPhone?: string;
    contactEmail?: string;
    direction?: CallDirection;
  },
): Promise<RuntimeAgentPayload> {
  const existing = runtimePrefetch.get(callId);
  if (existing) return existing;
  const promise = fetchRuntimeAgent(agentId, opts).catch((err) => {
    runtimePrefetch.delete(callId);
    throw err;
  });
  runtimePrefetch.set(callId, promise);
  return promise;
}

export function takePrefetchedRuntime(callId: string): Promise<RuntimeAgentPayload> | undefined {
  const promise = runtimePrefetch.get(callId);
  if (promise) runtimePrefetch.delete(callId);
  return promise;
}

export function dropPrefetchedRuntime(callId: string): void {
  runtimePrefetch.delete(callId);
}

export async function fetchRuntimeAgent(
  agentId: string,
  opts?: {
    prospectName?: string;
    contactPhone?: string;
    contactEmail?: string;
    direction?: CallDirection;
  },
): Promise<RuntimeAgentPayload> {
  const apiUrl = internalApiUrl();
  const params = new URLSearchParams();
  if (opts?.prospectName) params.set('prospectName', opts.prospectName);
  if (opts?.contactPhone) params.set('contactPhone', opts.contactPhone);
  if (opts?.contactEmail) params.set('contactEmail', opts.contactEmail);
  const qs = params.toString();
  const url = `${apiUrl}/api/simulator2/agents/${agentId}/runtime${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load agent runtime (${res.status})`);
  const data = (await res.json()) as RuntimeAgentPayload;
  data.skillsConfig = mergeSkillsConfig(data.skillsConfig);
  const callLlm = resolveCallLlm(data);
  data.llmProvider = callLlm.provider;
  data.llmModel = callLlm.model;

  const { instructions, knownContact } = buildSimulator2Instructions({
    agent: data,
    direction: opts?.direction ?? 'outbound',
    prospectName: opts?.prospectName,
    contactPhone: opts?.contactPhone,
    contactEmail: opts?.contactEmail,
    skills: data.skillsConfig,
  });
  data.compiledSystemPrompt = instructions;
  data.knownContact = knownContact;
  return data;
}

export function telephonyLlmLabel(agent: RuntimeAgentPayload): string {
  const ep = resolveTelephonyLlm(agent);
  return `${ep.model} (${ep.label})`;
}

function resolveTelephonyLlm(agent: RuntimeAgentPayload): LlmEndpoint {
  const llm = resolveCallLlm(agent);
  if (llm.provider === 'groq') {
    const groqKey = process.env.GROQ_API_KEY?.trim();
    if (!groqKey) throw new Error('GROQ_API_KEY is not configured');
    return {
      label: 'Groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groqKey,
      model: llm.model,
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) throw new Error('OPENAI_API_KEY is not configured');
  return {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: openaiKey,
    model: llm.model,
  };
}

function usesMaxCompletionTokens(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');
}

async function streamChat(
  agent: RuntimeAgentPayload,
  messages: ChatMessage[],
  tools?: TelephonyToolDef[],
  opts?: { signal?: AbortSignal; onDelta?: (content: string) => void; promptCacheKey?: string },
): Promise<{ content: string; toolCalls?: OpenAiToolCall[]; usage: LlmUsage }> {
  const ep = resolveTelephonyLlm(agent);
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: ep.model,
    stream: true,
    messages,
  };
  if (usesMaxCompletionTokens(ep.model)) {
    body.max_completion_tokens = MAX_SPOKEN_TOKENS;
  } else {
    body.max_tokens = MAX_SPOKEN_TOKENS;
    body.temperature = 0.4;
  }
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (ep.label === 'OpenAI') {
    body.stream_options = { include_usage: true };
    if (opts?.promptCacheKey) body.prompt_cache_key = opts.promptCacheKey;
  }

  const res = await fetch(ep.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ep.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${ep.label} error (${res.status}): ${err.slice(0, 200)}`);
  }
  if (!res.body) throw new Error(`${ep.label} returned an empty stream`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = '';
  let content = '';
  let firstContentMs = 0;
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedPromptTokens = 0;
  let sawToolDelta = false;

  const handleData = (raw: string) => {
    if (!raw || raw === '[DONE]') return;
    let parsed: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.usage) {
      promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
      completionTokens = parsed.usage.completion_tokens ?? completionTokens;
      cachedPromptTokens =
        parsed.usage.prompt_tokens_details?.cached_tokens ?? cachedPromptTokens;
    }
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return;
    for (const call of delta.tool_calls ?? []) {
      sawToolDelta = true;
      const index = call.index ?? 0;
      const prev = toolAcc.get(index) ?? { id: '', name: '', arguments: '' };
      if (call.id) prev.id = call.id;
      if (call.function?.name) prev.name += call.function.name;
      if (call.function?.arguments) prev.arguments += call.function.arguments;
      toolAcc.set(index, prev);
    }
    if (delta.content) {
      if (!firstContentMs) firstContentMs = Date.now() - started;
      content += delta.content;
      if (!sawToolDelta) opts?.onDelta?.(content);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuf += decoder.decode(value, { stream: true });
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      handleData(trimmed.slice(5).trim());
    }
  }
  if (lineBuf.trim().startsWith('data:')) handleData(lineBuf.trim().slice(5).trim());

  const toolCalls: OpenAiToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, call]) => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments },
    }))
    .filter((c) => c.id && c.function.name);

  return {
    content: content.trim(),
    toolCalls: toolCalls.length ? toolCalls : undefined,
    usage: {
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      ttftMs: firstContentMs || Date.now() - started,
    },
  };
}

export async function generateAgentText(
  agent: RuntimeAgentPayload,
  messages: ChatMessage[],
  opts?: { promptCacheKey?: string },
): Promise<LlmTextResult> {
  const result = await streamChat(agent, messages, undefined, opts);
  if (!result.content) throw new Error('LLM returned empty response');
  return { text: result.content, usage: result.usage };
}

export async function streamOutboundOpener(
  agent: RuntimeAgentPayload,
  prospectName?: string,
  streamOpts?: StreamReplyOpts,
): Promise<LlmTextResult> {
  const instructions = buildOutboundOpenerInstructions(agent, prospectName);
  const emit = sentenceEmitter(streamOpts?.onSentence);
  const result = await streamChat(
    agent,
    [
      { role: 'system', content: agent.compiledSystemPrompt },
      { role: 'user', content: instructions },
    ],
    undefined,
    {
      signal: streamOpts?.signal,
      onDelta: emit.onDelta,
      promptCacheKey: streamOpts?.promptCacheKey,
    },
  );
  emit.flush();
  if (!result.content) throw new Error('LLM returned empty opener');
  return { text: result.content, usage: result.usage };
}

export async function streamReply(
  agent: RuntimeAgentPayload,
  history: ChatMessage[],
  userText: string,
  toolCtx?: TelephonyToolContext,
  streamOpts?: StreamReplyOpts,
): Promise<LlmTextResult> {
  const spokenHistory = trimSpokenHistoryForLlm(history);
  const messages: ChatMessage[] = [
    { role: 'system', content: agent.compiledSystemPrompt },
    ...spokenHistory,
    { role: 'user', content: userText },
  ];
  const tools = toolCtx
    ? createTelephonyTools(agent.knownContact ?? undefined, toolCtx.bookingPolicy ?? agent.skillsConfig?.booking)
    : undefined;
  const promptCacheKey = streamOpts?.promptCacheKey ?? toolCtx?.callId;

  let promptTokens = 0;
  let completionTokens = 0;
  let cachedPromptTokens = 0;
  let ttftMs = 0;
  let hangup = false;
  let bookingSaved = false;
  let spokenFromTools = '';
  let hotelRatesSpoken = false;

  for (let i = 0; i < 4; i++) {
    const emit = sentenceEmitter(streamOpts?.onSentence);
    let result: Awaited<ReturnType<typeof streamChat>>;
    try {
      result = await streamChat(agent, messages, tools, {
        signal: streamOpts?.signal,
        onDelta: emit.onDelta,
        promptCacheKey,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (toolCtx && i === 0) {
        return generateAgentText(
          agent,
          [
            { role: 'system', content: agent.compiledSystemPrompt },
            ...spokenHistory,
            { role: 'user', content: userText },
          ],
          { promptCacheKey },
        ).then((fallback) => {
          streamOpts?.onSentence?.(fallback.text);
          return fallback;
        });
      }
      throw err;
    }
    promptTokens += result.usage.promptTokens;
    completionTokens += result.usage.completionTokens;
    cachedPromptTokens += result.usage.cachedPromptTokens ?? 0;
    if (i === 0) ttftMs = result.usage.ttftMs;
    if (result.content) spokenFromTools = result.content;

    if (result.toolCalls?.length && toolCtx) {
      messages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.toolCalls,
      });
      for (const call of result.toolCalls) {
        if (streamOpts?.onToolHold) {
          try {
            await streamOpts.onToolHold(call.function.name);
          } catch (err) {
            if (isAbortError(err)) throw err;
            console.warn('[telephony] tool hold speech failed', err);
          }
        }
        const output = await executeTelephonyTool(
          call.function.name,
          call.function.arguments,
          toolCtx,
        );
        if (
          call.function.name === 'lookup_hotel_availability' &&
          output &&
          typeof output === 'object' &&
          (output as { fallback_to_brain?: boolean }).fallback_to_brain !== true &&
          typeof (output as { say?: unknown }).say === 'string'
        ) {
          const say = String((output as { say: string }).say).trim();
          if (say) {
            // Speak live rates immediately — skip another LLM round-trip (phone latency).
            streamOpts?.onSentence?.(say);
            spokenFromTools = say;
            hotelRatesSpoken = true;
          }
        }
        if (output && typeof output === 'object' && 'hangup' in output && (output as { hangup?: boolean }).hangup) {
          hangup = true;
          const reason =
            output && typeof output === 'object' && 'reason' in output
              ? String((output as { reason?: string }).reason ?? '')
              : '';
          console.log('[telephony] end_call tool', reason || call.function.name);
        }
        if (
          call.function.name === 'capture_demo_lead' &&
          output &&
          typeof output === 'object' &&
          'ok' in output &&
          (output as { ok?: boolean }).ok
        ) {
          bookingSaved = true;
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(output),
        });
      }
      if (hotelRatesSpoken && spokenFromTools.trim()) {
        emit.flush();
        return {
          text: spokenFromTools,
          usage: { promptTokens, completionTokens, cachedPromptTokens, ttftMs },
          hangup,
          bookingSaved,
        };
      }
      continue;
    }

    if (!result.content && hangup) {
      const text = spokenFromTools || 'Dhanyavaad, bye!';
      emit.flush();
      if (!spokenFromTools) streamOpts?.onSentence?.(text);
      return {
        text,
        usage: { promptTokens, completionTokens, cachedPromptTokens, ttftMs },
        hangup: true,
        bookingSaved,
      };
    }
    if (!result.content) throw new Error('LLM returned empty response');
    emit.flush();
    return {
      text: result.content,
      usage: { promptTokens, completionTokens, cachedPromptTokens, ttftMs },
      hangup,
      bookingSaved,
    };
  }

  if (hangup) {
    return {
      text: spokenFromTools || 'Dhanyavaad, bye!',
      usage: { promptTokens, completionTokens, cachedPromptTokens, ttftMs },
      hangup: true,
      bookingSaved,
    };
  }
  throw new Error('LLM tool loop exceeded');
}
