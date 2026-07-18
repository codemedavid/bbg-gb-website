// Browser-side API helpers. Unwraps the {success,data,error} envelope.
export type ApiEnvelope<T> = { success: boolean; data: T; error: string | null };

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body?.success) throw new Error(body?.error || `Request failed (${res.status})`);
  return body.data;
}

export const apiGet = <T>(path: string) =>
  fetch(`/api${path}`, { credentials: 'include' }).then((r) => parse<T>(r));

export const apiSend = <T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) =>
  fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body != null ? JSON.stringify(body) : undefined,
  }).then((r) => parse<T>(r));

export const qs = (params: Record<string, string | boolean | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};
