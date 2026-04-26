/**
 * Server-side fetch helpers for talking to the Nest backend from the BFF.
 *
 * `getBackendBaseUrl()` is centralised so a deployment can override the URL
 * without touching every route. Default is http://localhost:3000 (Nest dev
 * server).
 */
export function getBackendBaseUrl(): string {
  const url = process.env.ADMIN_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3000';
  return url.replace(/\/$/, '');
}

export interface BackendCallOptions {
  method?: string;
  bearer?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface BackendResult<T = unknown> {
  status: number;
  ok: boolean;
  data: T | null;
  raw: Response;
}

/**
 * Lightweight wrapper around fetch() that:
 *   - Joins paths to the Nest base URL
 *   - JSON-encodes / decodes
 *   - Attaches Bearer header when present
 *   - Returns both the parsed JSON and the raw Response so callers can
 *     forward upstream status codes verbatim
 */
export async function callBackend<T = unknown>(
  path: string,
  options: BackendCallOptions = {},
): Promise<BackendResult<T>> {
  const url = `${getBackendBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.bearer) headers['Authorization'] = `Bearer ${options.bearer}`;

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    cache: 'no-store',
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;

  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';
  let parsed: T | null = null;
  if (contentType.includes('application/json')) {
    parsed = (await res.json()) as T;
  } else if (res.status !== 204) {
    // Non-JSON, but still expose body as a string under .data so callers can
    // forward without crashing.
    parsed = (await res.text()) as unknown as T;
  }
  return { status: res.status, ok: res.ok, data: parsed, raw: res };
}
