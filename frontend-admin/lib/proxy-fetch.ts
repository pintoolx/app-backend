/**
 * Browser-side helper that always routes through the BFF proxy at
 * /api/admin/proxy/<backend-path>. Throws an Error decorated with `.status`
 * so React-Query's retry guard can short-circuit on 401/403.
 */
export interface ApiError extends Error {
  status: number;
  data: unknown;
}

export async function proxyFetch<T = unknown>(
  backendPath: string,
  init: RequestInit = {},
): Promise<T> {
  if (!backendPath.startsWith('/admin/')) {
    throw new Error(`proxyFetch requires a /admin/* path, got: ${backendPath}`);
  }
  const url = `/api/admin/proxy${backendPath}`;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  let body: unknown = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await res.json();
  } else if (res.status !== 204) {
    body = await res.text();
  }
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body && (body as { message?: unknown }).message) ||
      `HTTP ${res.status}`;
    const err = new Error(typeof message === 'string' ? message : 'Request failed') as ApiError;
    err.status = res.status;
    err.data = body;
    throw err;
  }
  return body as T;
}
