/**
 * Cliente HTTP mínimo para el backend FastAPI.
 */
import { env } from '@/config/env';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type QueryValue = string | number | boolean | undefined | null | string[];

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(env.apiBaseUrl + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }
  return url.toString();
}

export async function apiGet<T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
  const url = buildUrl(path, query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.apiTimeoutMs);
  signal?.addEventListener('abort', () => controller.abort());
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new ApiError(`El backend respondió ${response.status}`, response.status, url);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const reason = controller.signal.aborted ? 'tiempo de espera agotado' : 'sin conexión con el backend';
    throw new ApiError(`No se pudo consultar ${path}: ${reason}`, null, url);
  } finally {
    clearTimeout(timeout);
  }
}
