const BASE_URL = 'https://api.deepseek.com';
const REQUEST_TIMEOUT_MS = 15000;

export class DeepSeekError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(
  path: string,
  body: unknown,
  apiKey: string,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new DeepSeekError(
      response.status,
      `DeepSeek 请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 200)}` : ''}`,
    );
  }
  return (await response.json()) as T;
}

const compact = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

export interface DeepSeekSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export async function searchDeepSeek(
  query: string,
  count: number,
  apiKey: string,
): Promise<DeepSeekSearchHit[]> {
  const payload = await post<{
    results?: {
      title?: string | null;
      url?: string | null;
      summary?: string | null;
    }[];
  }>('/v1/tools/search', { query, count }, apiKey);
  return (payload.results ?? [])
    .flatMap((item) =>
      item.url
        ? [
            {
              url: item.url,
              title: compact(item.title) || item.url,
              snippet: compact(item.summary),
            },
          ]
        : [],
    )
    .slice(0, count);
}

export async function fetchDeepSeek(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ title: string | null; text: string }> {
  const payload = await post<{ title?: string | null; content?: string | null }>(
    '/v1/tools/fetch',
    { url },
    apiKey,
    signal,
  );
  return { title: compact(payload.title) || null, text: payload.content ?? '' };
}
