import type { Server } from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { TelephonyCallSession } from './call-session.js';
import { emitTelephonyEvent } from './event-bus.js';
import { resolveCallIdForStart } from './resolve-call.js';

const sessions = new Map<WebSocket, TelephonyCallSession>();
const preSession = new Map<WebSocket, string[]>();

function logStartSummary(msg: Record<string, unknown>): Record<string, unknown> {
  const start = msg.start as Record<string, unknown> | undefined;
  const custom = start?.customParameters;
  return {
    streamSid: msg.streamSid ?? start?.streamSid,
    callSid: start?.callSid,
    from: start?.from,
    to: start?.to,
    direction: start?.direction,
    customKeys:
      custom && typeof custom === 'object' ? Object.keys(custom as object) : [],
  };
}

export function attachTelephonyWebSocket(server: Server, path = '/stream'): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host ?? 'localhost';
    const pathname = new URL(req.url ?? '/', `http://${host}`).pathname;
    if (pathname !== path) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);
    const callIdFromUrl = url.searchParams.get('callId')?.trim();

    console.log('[telephony] WebSocket connected', {
      callIdFromUrl: callIdFromUrl ?? null,
      remote: req.socket.remoteAddress,
    });

    if (callIdFromUrl) {
      const session = new TelephonyCallSession(ws, callIdFromUrl);
      sessions.set(ws, session);
      session.emitLog('info', 'WebSocket connected', { callIdFromUrl }, 'ws');
    }

    ws.on('message', (data) => {
      void ingestMessage(ws, data, callIdFromUrl);
    });

    ws.on('close', (code, reason) => {
      const session = sessions.get(ws);
      const callId = session?.callId ?? callIdFromUrl ?? null;
      console.log('[telephony] WebSocket closed', {
        code,
        reason: reason.toString(),
        callId,
      });
      if (session) {
        session.emitLog('info', `WebSocket closed (${code})`, {
          reason: reason.toString(),
        }, 'ws');
      }
      session?.close();
      sessions.delete(ws);
      preSession.delete(ws);
    });

    ws.on('error', (err) => {
      const session = sessions.get(ws);
      console.error('[telephony] WebSocket error', err);
      session?.emitLog('error', err instanceof Error ? err.message : 'WebSocket error');
      session?.close();
    });
  });

  console.log(`[telephony] WebSocket listening on path ${path}`);
}

async function ingestMessage(
  ws: WebSocket,
  data: WebSocket.RawData,
  callIdFromUrl?: string | null,
): Promise<void> {
  const raw = typeof data === 'string' ? data : data.toString('utf8');
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  let session = sessions.get(ws);

  if (!session && msg.event === 'start') {
    const summary = logStartSummary(msg);
    console.log('[telephony] start event', summary);
    const callId = (await resolveCallIdForStart(msg)) ?? callIdFromUrl;
    if (!callId) {
      console.error('[telephony] could not resolve callId from start event');
      ws.close(1008, 'callId not found in start event');
      return;
    }
    session = sessions.get(ws) ?? new TelephonyCallSession(ws, callId);
    sessions.set(ws, session);
    session.emitLog('info', 'Resolved call from start event', summary, 'smartflo');
  }

  if (!session) {
    const queued = preSession.get(ws) ?? [];
    queued.push(raw);
    if (queued.length > 400) queued.shift();
    preSession.set(ws, queued);
    return;
  }

  const queued = preSession.get(ws);
  if (queued?.length) {
    preSession.delete(ws);
    for (const item of queued) {
      void session.handleMessage(item);
    }
  }

  void session.handleMessage(raw).catch((err) => {
    const message = err instanceof Error ? err.message : 'handleMessage error';
    console.error('[telephony] handleMessage error', err);
    session?.emitLog('error', message);
    emitTelephonyEvent(session!.callId, { type: 'error', message });
  });
}

export function publicWssUrl(callId: string): string {
  const base = process.env.TELEPHONY_WSS_PUBLIC_URL?.trim();
  if (!base) {
    throw new Error('TELEPHONY_WSS_PUBLIC_URL is not configured');
  }
  const url = new URL(base);
  url.searchParams.set('callId', callId);
  return url.toString();
}
