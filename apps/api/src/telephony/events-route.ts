import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { subscribeTelephonyEvents } from './event-bus.js';

export function handleTelephonySse(req: Request, res: Response): void {
  const rawId = req.params.callId;
  const callId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!callId) {
    res.status(400).json({ error: 'callId is required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const write = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  write({ type: 'log', level: 'info', category: 'sse', message: 'Live events connected' });

  const unsubscribe = subscribeTelephonyEvents(callId, (event) => {
    write(event);
  });

  void prisma.call.findUnique({ where: { id: callId }, select: { status: true } }).then((call) => {
    if (call?.status) write({ type: 'status', status: call.status, ts: Date.now() });
  });

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
