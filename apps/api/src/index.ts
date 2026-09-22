import './load-env.js';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { callsRouter } from './routes/calls.js';
import { agentsRouter } from './routes/agents.js';
import { livekitRouter } from './routes/livekit.js';
import { leadsRouter } from './routes/leads.js';
import { calendarRouter } from './routes/calendar.js';
import { ttsRouter } from './routes/tts.js';
import { simulator2Router } from './simulator2/index.js';
import { telephonyRouter } from './telephony/routes.js';
import { attachTelephonyWebSocket } from './telephony/ws-server.js';
import { prisma } from './db.js';
import { dispatchCallCompletedWebhook } from './call-webhook.js';
import { hangupSmartfloWithCandidates } from './telephony/acefone-client.js';
import { emitTelephonyEvent } from './telephony/event-bus.js';
import { hasCallSession } from './telephony/session-registry.js';

const app = express();
const port = Number(process.env.API_PORT ?? 3001);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  }),
);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/agents', agentsRouter);
app.use('/api/calls', callsRouter);
app.use('/api/livekit', livekitRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/tts', ttsRouter);
app.use('/api/simulator2', simulator2Router);
app.use('/api/telephony', telephonyRouter);

const server = createServer(app);
attachTelephonyWebSocket(server, '/stream');

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} already in use — kill the old API process and retry.`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  console.log(`Telephony WebSocket on ws://localhost:${port}/stream`);
  void reconcileAbandonedTelephonyCalls();
  setInterval(() => {
    void reconcileAbandonedTelephonyCalls({ orphansOnly: true });
  }, 15_000);
});

async function reconcileAbandonedTelephonyCalls(opts?: { orphansOnly?: boolean }): Promise<void> {
  const stuck = await prisma.call.findMany({
    where: {
      source: 'click-to-call',
      status: { in: ['initiating', 'ringing', 'in-progress'] },
    },
    select: { id: true, status: true, externalCallId: true, startedAt: true },
  });
  const now = Date.now();
  const orphans = stuck.filter((call) => {
    if (hasCallSession(call.id)) return false;
    if (!opts?.orphansOnly) return true;
    const age = now - call.startedAt.getTime();
    if (call.status === 'in-progress') return age > 15_000;
    return age > 90_000;
  });
  if (!orphans.length) return;
  console.log(`[telephony] Completing ${orphans.length} abandoned outbound call(s)`);
  for (const call of orphans) {
    if (call.externalCallId) {
      try {
        await hangupSmartfloWithCandidates(call.externalCallId);
      } catch {
        /* already dead */
      }
    }
    const status = call.status === 'in-progress' ? 'completed' : 'failed';
    await prisma.call.update({
      where: { id: call.id },
      data: { status, endedAt: new Date() },
    }).catch(() => undefined);
    emitTelephonyEvent(call.id, { type: 'status', status });
    void dispatchCallCompletedWebhook(call.id).catch((err) => {
      console.error('[telephony] call.completed webhook failed', call.id, err);
    });
  }
}
