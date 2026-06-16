import type { ChatMessage } from "./qwen";

/** Injectable chat function so the gate is testable without a live LLM. */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export interface GateContext {
  symbol: string;
  direction: "rich" | "cheap";
  /** Signed dislocation vs fair value (decimal). */
  dislocationPct: number;
  /** Session label, e.g. "weekend" / "overnight". */
  sessionLabel: string;
  /** Off-hours news/macro context (from Agent Hub news-briefing / macro-analyst). */
  newsSummary: string;
}

export interface GateVerdict {
  /** True = gap looks like noise that reverts at the open; false = justified repricing, stand down. */
  fadeable: boolean;
  /** Multiplier applied to the dislocation confidence, 0–1. */
  confidenceMultiplier: number;
  rationale: string;
}

const SYSTEM_PROMPT =
  "You are a risk analyst for a tokenized-US-stock trading agent. The tokenized product can trade " +
  "or quote while the underlying US market is closed, so a gap is either (a) noise/sentiment that reverts at the open " +
  "[fadeable] or (b) justified repricing from real overnight news [not fadeable]. " +
  'Respond ONLY with compact JSON: {"fadeable": boolean, "confidenceMultiplier": number 0..1 = your conviction this gap is fadeable noise (use ~0 for justified repricing), "rationale": short string}.';

export function buildMessages(ctx: GateContext): ChatMessage[] {
  const user =
    `Symbol: ${ctx.symbol}\n` +
    `Session: ${ctx.sessionLabel}\n` +
    `Token is ${ctx.direction} by ${(ctx.dislocationPct * 100).toFixed(2)}% vs fair value.\n` +
    `Off-hours news/context: ${ctx.newsSummary}\n` +
    "Should the agent fade this gap (expect convergence at the open)?";
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** Extract the verdict from the model's reply, tolerating prose around the JSON. */
export function parseVerdict(raw: string): GateVerdict {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in gate response: ${raw.slice(0, 120)}`);
  const obj = JSON.parse(match[0]) as Partial<GateVerdict>;
  const fadeable = Boolean(obj.fadeable);
  const m =
    typeof obj.confidenceMultiplier === "number"
      ? obj.confidenceMultiplier
      : fadeable
        ? 1
        : 0;
  return {
    fadeable,
    confidenceMultiplier: Math.min(1, Math.max(0, m)),
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
  };
}

/**
 * Ask the LLM whether an off-hours dislocation is a fadeable convergence or justified repricing.
 * Its `confidenceMultiplier` scales the deterministic dislocation confidence before the risk governor.
 */
export async function assessConvergence(
  ctx: GateContext,
  chat: ChatFn,
): Promise<GateVerdict> {
  return parseVerdict(await chat(buildMessages(ctx)));
}

/**
 * The scalar to multiply the deterministic dislocation confidence by. `fadeable` is the hard
 * gate: a non-fadeable (justified-repricing) verdict zeroes the trade regardless of the model's
 * stated multiplier, so the agent never fades real overnight news.
 */
export function effectiveMultiplier(v: GateVerdict): number {
  return v.fadeable ? v.confidenceMultiplier : 0;
}
