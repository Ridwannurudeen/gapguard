import { createHmac } from "node:crypto";
import { canonicalJson } from "./canonicalJson";
import { fetchTextWithRetry } from "./http";

export { canonicalJson };

export const BITGET_WALLET_BASE_URL = "https://bopenapi.bgwapi.io";

export interface BitgetAuth {
  apiKey: string;
  apiSecret: string;
}

export interface BitgetRequestConfig {
  baseUrl?: string;
  auth?: BitgetAuth;
  nowMs?: () => number;
  timeoutMs?: number;
  retries?: number;
  maxResponseChars?: number;
}

export interface BitgetHttpResponse {
  statusCode: number;
  bodyText: string;
  json?: unknown;
}

export function buildSignaturePayload(
  apiPath: string,
  body: string,
  apiKey: string,
  timestamp: string,
  queryParams: Record<string, string> = {},
): string {
  const content: Record<string, string> = {
    apiPath,
    body,
    "x-api-key": apiKey,
    "x-api-timestamp": timestamp,
  };
  for (const [key, value] of Object.entries(queryParams)) {
    content[key] = value;
  }

  const sorted = Object.fromEntries(
    Object.keys(content)
      .sort()
      .map((key) => [key, content[key]]),
  );
  return JSON.stringify(sorted);
}

export function signBitgetRequest(
  apiPath: string,
  body: string,
  apiKey: string,
  apiSecret: string,
  timestamp: string,
  queryParams: Record<string, string> = {},
): string {
  return createHmac("sha256", apiSecret)
    .update(
      buildSignaturePayload(apiPath, body, apiKey, timestamp, queryParams),
    )
    .digest("base64");
}

export async function postBitget<TBody extends object>(
  path: string,
  body: TBody,
  cfg: BitgetRequestConfig = {},
): Promise<BitgetHttpResponse> {
  const bodyText = canonicalJson(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (cfg.auth) {
    const timestamp = String(cfg.nowMs?.() ?? Date.now());
    headers["x-api-key"] = cfg.auth.apiKey;
    headers["x-api-timestamp"] = timestamp;
    headers["x-api-signature"] = signBitgetRequest(
      path,
      bodyText,
      cfg.auth.apiKey,
      cfg.auth.apiSecret,
      timestamp,
    );
  }

  const res = await fetchTextWithRetry(
    `${cfg.baseUrl ?? BITGET_WALLET_BASE_URL}${path}`,
    {
      method: "POST",
      headers,
      body: bodyText,
    },
    {
      timeoutMs: cfg.timeoutMs,
      retries: cfg.retries,
      maxResponseChars: cfg.maxResponseChars,
    },
  );
  const text = res.text;
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { statusCode: res.status, bodyText: text, json };
}

export function authFromEnv(env: NodeJS.ProcessEnv): BitgetAuth | undefined {
  const apiKey = env.BITGET_WALLET_API_KEY;
  const apiSecret = env.BITGET_WALLET_API_SECRET;
  if (!apiKey || !apiSecret) return undefined;
  return { apiKey, apiSecret };
}
