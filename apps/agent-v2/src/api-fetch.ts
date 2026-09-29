/** Shared Authorization header for agent-v2 → API fetches. */
export function apiAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = process.env.API_AUTH_TOKEN?.trim();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const apiUrl = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${apiUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = new Headers(init?.headers);
  const token = process.env.API_AUTH_TOKEN?.trim();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}
