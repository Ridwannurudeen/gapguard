const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RESPONSE_CHARS = 1_000_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function transportError(err) {
  return err instanceof TypeError || err?.name === "AbortError";
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTextWithRetry(url, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxResponseChars =
    options.maxResponseChars ?? DEFAULT_MAX_RESPONSE_CHARS;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      const text = await response.text();
      if (text.length > maxResponseChars) {
        throw new Error(
          `HTTP response exceeded ${maxResponseChars} characters; refusing to parse`,
        );
      }
      if (
        !response.ok &&
        attempt < retries &&
        retryableStatus(response.status)
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
      lastError = err instanceof Error ? err : new Error("HTTP request failed");
      if (attempt < retries && transportError(err)) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("HTTP request failed");
}
