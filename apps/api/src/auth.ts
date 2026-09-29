import type { NextFunction, Request, Response } from 'express';

/** Shared secret for Studio / agent-v2 / outbound control plane. */
export function configuredApiAuthToken(): string {
  return process.env.API_AUTH_TOKEN?.trim() ?? '';
}

export function isApiAuthEnabled(): boolean {
  return Boolean(configuredApiAuthToken());
}

export function extractRequestToken(req: Request): string | null {
  const header = req.headers.authorization?.trim();
  if (header?.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() || null;
  }
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim();
  const query = req.query?.token;
  if (typeof query === 'string' && query.trim()) return query.trim();
  return null;
}

export function tokenMatches(provided: string | null | undefined): boolean {
  const expected = configuredApiAuthToken();
  if (!expected) return true;
  return Boolean(provided && provided === expected);
}

/** Provider callbacks that cannot send Studio tokens. */
const PUBLIC_API_PREFIXES = [
  '/api/telephony/webhooks',
  '/api/telephony/voice',
];

export function isPublicApiPath(urlPath: string): boolean {
  const path = urlPath.split('?')[0] ?? urlPath;
  return PUBLIC_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Protect /api/* when API_AUTH_TOKEN is set.
 * Acefone webhooks + voice endpoint stay public.
 */
export function requireApiAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isApiAuthEnabled() || isPublicApiPath(req.originalUrl)) {
    next();
    return;
  }
  if (tokenMatches(extractRequestToken(req))) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
}

export function authHeadersForServerFetch(): Record<string, string> {
  const token = configuredApiAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
