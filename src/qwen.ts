export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface QwenConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const DEFAULT_BASE = "https://hackathon.bitgetops.com/v1";
const DEFAULT_MODEL = "qwen3.6-plus";

interface ChatCompletion {
  choices: { message: { content: string } }[];
}

/**
 * Minimal client for the Bitget hackathon Qwen endpoint (OpenAI-compatible chat completions).
 * Throws on transport or shape errors — this is a system boundary, so failures propagate.
 */
export async function qwenChat(
  messages: ChatMessage[],
  cfg: QwenConfig,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl ?? DEFAULT_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model ?? DEFAULT_MODEL,
      messages,
      temperature: 0,
    }),
  });
  if (!res.ok) {
    throw new Error(`Qwen request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as ChatCompletion;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string")
    throw new Error("Qwen response missing content");
  return content;
}
