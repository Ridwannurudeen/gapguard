export interface BoundedFetchOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  maxResponseChars?: number;
}

export interface BoundedFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RESPONSE_CHARS = 262_144;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isTransportError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    (err instanceof Error && err.name === "AbortError")
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(
  response: Response,
  maxResponseChars: number,
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (text.length > maxResponseChars) {
      throw new Error(
        `HTTP response exceeded ${maxResponseChars} characters; refusing to parse`,
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > maxResponseChars) {
      await reader.cancel();
      throw new Error(
        `HTTP response exceeded ${maxResponseChars} characters; refusing to parse`,
      );
    }
  }

  text += decoder.decode();
  if (text.length > maxResponseChars) {
    throw new Error(
      `HTTP response exceeded ${maxResponseChars} characters; refusing to parse`,
    );
  }
  return text;
}

export async function fetchTextWithRetry(
  url: string,
  init: RequestInit = {},
  options: BoundedFetchOptions = {},
): Promise<BoundedFetchResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxResponseChars =
    options.maxResponseChars ?? DEFAULT_MAX_RESPONSE_CHARS;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      const text = await readBoundedText(response, maxResponseChars);
      if (
        !response.ok &&
        attempt < retries &&
        isRetryableStatus(response.status)
      ) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
      };
    } catch (err) {
      lastError =
        err instanceof Error ? err : new Error("HTTP request failed");
      if (attempt < retries && isTransportError(err)) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("HTTP request failed");
}
