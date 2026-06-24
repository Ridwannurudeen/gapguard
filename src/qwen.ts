import { fetchTextWithRetry } from "./http";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type QwenModelRole = "deep" | "quick";

export interface QwenConfig {
  apiKey: string;
  baseUrl?: string;
  /** Legacy/global override. When set, it wins over role-specific models. */
  model?: string;
  deepModel?: string;
  quickModel?: string;
  modelRole?: QwenModelRole;
  maxTokens?: number;
  maxResponseChars?: number;
  retries?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
}

export interface QwenEnvConfig {
  apiKey?: string;
  model?: string;
  deepModel?: string;
  quickModel?: string;
}

const DEFAULT_BASE = "https://hackathon.bitgetops.com/v1";
export const DEFAULT_QWEN_DEEP_MODEL = "qwen3.6-plus";
export const DEFAULT_QWEN_QUICK_MODEL = "qwen3.6-flash";
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_MAX_RESPONSE_CHARS = 16_384;
const DEFAULT_RETRIES = 1;
const DEFAULT_TIMEOUT_MS = 30_000;

interface ChatCompletion {
  choices: { message: { content: string } }[];
}

function envValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function qwenConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): QwenEnvConfig {
  return {
    apiKey: envValue(env.BITGET_QWEN_API_KEY),
    model: envValue(env.BITGET_QWEN_MODEL),
    deepModel: envValue(env.BITGET_QWEN_DEEP_MODEL),
    quickModel: envValue(env.BITGET_QWEN_QUICK_MODEL),
  };
}

export function qwenModelForRole(
  cfg: Pick<QwenConfig, "model" | "deepModel" | "quickModel" | "modelRole">,
): string {
  if (cfg.model) return cfg.model;
  return (cfg.modelRole ?? "deep") === "quick"
    ? (cfg.quickModel ?? DEFAULT_QWEN_QUICK_MODEL)
    : (cfg.deepModel ?? DEFAULT_QWEN_DEEP_MODEL);
}

function requestBody(
  messages: ChatMessage[],
  cfg: QwenConfig,
  jsonMode: boolean,
): string {
  return JSON.stringify({
    model: qwenModelForRole(cfg),
    messages,
    temperature: 0,
    max_tokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });
}

function boundedDiagnostic(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 240);
}

/**
 * Minimal client for the Bitget hackathon Qwen endpoint (OpenAI-compatible chat completions).
 * Throws on transport or shape errors; this is a system boundary, so failures propagate.
 */
export async function qwenChat(
  messages: ChatMessage[],
  cfg: QwenConfig,
): Promise<string> {
  const url = `${cfg.baseUrl ?? DEFAULT_BASE}/chat/completions`;
  const retries = cfg.retries ?? DEFAULT_RETRIES;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseChars = cfg.maxResponseChars ?? DEFAULT_MAX_RESPONSE_CHARS;
  const jsonMode = cfg.jsonMode ?? true;

  const res = await fetchTextWithRetry(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody(messages, cfg, jsonMode),
    },
    { retries, timeoutMs, maxResponseChars },
  );
  if (!res.ok) {
    throw new Error(
      `Qwen request failed: ${res.status} ${res.statusText} ${boundedDiagnostic(res.text)}`.trim(),
    );
  }

  const data = JSON.parse(res.text) as ChatCompletion;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Qwen response missing content");
  }
  if (content.length > maxResponseChars) {
    throw new Error(
      `Qwen message content exceeded ${maxResponseChars} characters`,
    );
  }
  return content;
}
