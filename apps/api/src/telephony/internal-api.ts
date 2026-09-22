/** Loopback API base for server-side fetches (avoid ngrok round-trips during live calls). */
export function internalApiUrl(): string {
  const explicit = process.env.INTERNAL_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const port = process.env.API_PORT ?? '3001';
  return `http://127.0.0.1:${port}`;
}
