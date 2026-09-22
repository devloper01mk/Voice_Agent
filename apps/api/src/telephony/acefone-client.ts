const DEFAULT_BASE = 'https://api-smartflo.tatateleservices.com';

export interface ClickToCallSupportParams {
  customerNumber: string;
  callerId?: string;
  customIdentifier?: string;
  customerRingTimeout?: number;
}

export interface ClickToCallSupportResult {
  success: boolean;
  message?: string;
  refId?: string;
  raw: unknown;
}

function authToken(): string | undefined {
  return (
    process.env.SMARTFLO_API_TOKEN?.trim() ||
    process.env.ACEFONE_API_TOKEN?.trim() ||
    process.env.TATA_API_TOKEN?.trim()
  );
}

function clickToCallApiKey(): string {
  const key =
    process.env.ACEFONE_CLICK_TO_CALL_API_KEY?.trim() ||
    process.env.SMARTFLO_CLICK_TO_CALL_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'ACEFONE_CLICK_TO_CALL_API_KEY is not configured (Smartflo Click-to-Call Support API key)',
    );
  }
  return key;
}

/** Smartflo expects alphanumeric custom ids; strip hyphens from UUIDs. */
function buildCustomIdentifier(callId: string): Record<string, string> {
  const normalized = callId.replace(/[^a-zA-Z0-9]/g, '');
  return { call_id: normalized, vsaCallId: normalized };
}

export async function initiateClickToCallSupport(
  params: ClickToCallSupportParams,
): Promise<ClickToCallSupportResult> {
  const apiKey = clickToCallApiKey();
  const token = authToken();
  if (!token) {
    throw new Error(
      'SMARTFLO_API_TOKEN is not configured. Create one under API Connect → API Tokens in the Smartflo portal.',
    );
  }

  const base = (
    process.env.ACEFONE_API_BASE_URL ??
    process.env.SMARTFLO_API_BASE_URL ??
    DEFAULT_BASE
  ).replace(/\/$/, '');

  const body: Record<string, unknown> = {
    customer_number: params.customerNumber,
    api_key: apiKey,
    async: 1,
  };

  const callerId = params.callerId?.trim() || process.env.ACEFONE_FROM_NUMBER?.trim();
  if (callerId) body.caller_id = callerId.replace(/^\+/, '');

  if (params.customIdentifier) {
    body.custom_identifier = buildCustomIdentifier(params.customIdentifier);
  }
  if (params.customerRingTimeout != null) {
    body.customer_ring_timeout = params.customerRingTimeout;
  }

  const res = await fetch(`${base}/v1/click_to_call_support`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = extractErrorMessage(raw, res.status);
    throw new Error(message);
  }

  const success =
    (raw as { success?: boolean; Success?: boolean }).success ??
    (raw as { Success?: boolean }).Success ??
    false;

  return {
    success: Boolean(success),
    message: extractErrorMessage(raw, res.status),
    refId: typeof (raw as { ref_id?: string }).ref_id === 'string'
      ? (raw as { ref_id: string }).ref_id
      : undefined,
    raw,
  };
}

export async function hangupSmartfloCall(callSidOrRefId: string): Promise<void> {
  const token = authToken();
  if (!token) {
    throw new Error(
      'SMARTFLO_API_TOKEN is not configured. Create one under API Connect → API Tokens in the Smartflo portal.',
    );
  }
  const id = callSidOrRefId.trim();
  if (!id) throw new Error('Hangup requires call_id or ref_id');

  const base = (
    process.env.ACEFONE_API_BASE_URL ??
    process.env.SMARTFLO_API_BASE_URL ??
    DEFAULT_BASE
  ).replace(/\/$/, '');

  // Smartflo accepts either call_id (CDR/live) or ref_id (click-to-call response).
  // We used to always send call_id — UUID ref_ids then fail with "Invalid Call ID" and the
  // PSTN leg stays up while our UI marks the call completed.
  const bodies: Array<Record<string, string>> = isLikelySmartfloRefId(id)
    ? [{ ref_id: id }, { call_id: id }]
    : [{ call_id: id }, { ref_id: id }];

  let lastError: Error | undefined;
  for (const body of bodies) {
    const res = await fetch(`${base}/v1/call/hangup`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.json().catch(() => ({}));
    const successFlag =
      (raw as { success?: boolean }).success ?? (raw as { Success?: boolean }).Success;
    if (res.ok && successFlag !== false) {
      console.log('[telephony] Smartflo hangup accepted', {
        field: Object.keys(body)[0],
        idMasked: maskId(id),
      });
      return;
    }
    lastError = new Error(extractErrorMessage(raw, res.status));
    console.warn('[telephony] Smartflo hangup attempt failed', {
      field: Object.keys(body)[0],
      idMasked: maskId(id),
      status: res.status,
      message: lastError.message,
    });
  }

  throw lastError ?? new Error('Hangup API failed');
}

/** Try each candidate id (callSid and/or click-to-call ref_id) until Smartflo accepts hangup. */
export async function hangupSmartfloWithCandidates(
  ...ids: Array<string | null | undefined>
): Promise<string> {
  const unique = [...new Set(ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
  if (!unique.length) throw new Error('Hangup requires call_id or ref_id');

  let lastError: Error | undefined;
  for (const id of unique) {
    try {
      await hangupSmartfloCall(id);
      return id;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error('Hangup API failed');
}

/** Click-to-call Support returns UUID-like ref_id; live/CDR call_id looks like CAGE3-… or 1627….350. */
function isLikelySmartfloRefId(id: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
  if (/^SRH/i.test(id)) return true;
  return false;
}

export function looksLikeSmartfloRefId(id: string): boolean {
  return isLikelySmartfloRefId(id.trim());
}

function maskId(id: string): string {
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function extractErrorMessage(raw: unknown, status: number): string {
  if (!raw || typeof raw !== 'object') {
    return `Click-to-Call failed (${status})`;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.message === 'string' && r.message.trim()) return r.message;
  if (typeof r.Message === 'string' && r.Message.trim()) return r.Message;

  const fieldErrors: string[] = [];
  for (const [key, val] of Object.entries(r)) {
    if (Array.isArray(val)) {
      fieldErrors.push(`${key}: ${val.join(', ')}`);
    }
  }
  if (fieldErrors.length) return fieldErrors.join('; ');

  return `Click-to-Call failed (${status})`;
}
