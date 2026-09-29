export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

function usesMaxCompletionTokens(providerLabel: string, model: string): boolean {
  if (providerLabel !== 'OpenAI') return false;
  const m = model.toLowerCase();
  return (
    m.startsWith('gpt-5') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  );
}

export async function callChatApi({
  url,
  apiKey,
  model,
  messages,
  maxTokens,
  providerLabel,
  temperature = 0.2,
}: {
  url: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  providerLabel: string;
  temperature?: number;
}): Promise<string> {
  if (!apiKey) {
    throw new Error(`${providerLabel} API key is not configured on the API server`);
  }

  const tokenLimit = usesMaxCompletionTokens(providerLabel, model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      ...tokenLimit,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${providerLabel} chat failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`${providerLabel} returned an empty response`);
  }
  return text;
}

export async function callLlmJson<T>(opts: {
  llmProvider?: 'gpt';
  llmModel: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  const raw = await callChatApi({
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY,
    model: opts.llmModel,
    maxTokens: opts.maxTokens ?? 800,
    providerLabel: 'OpenAI',
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  });

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM did not return JSON');
  return JSON.parse(jsonMatch[0]) as T;
}
