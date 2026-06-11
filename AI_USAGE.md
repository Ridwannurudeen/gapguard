# AI Usage

GapGuard uses an LLM as a **convergence gate**, not as a black-box trader. The deterministic
layers (session clock, dislocation z-score, risk governor) decide *how much* to trade; the LLM
decides *whether the gap is fadeable at all* — separating off-hours noise that reverts at the
open from justified repricing on real overnight news.

## Model & endpoint

- **Model:** `qwen3.6-plus` (Bitget hackathon Qwen subsidy).
- **Endpoint:** `POST https://hackathon.bitgetops.com/v1/chat/completions` (OpenAI-compatible).
- **Auth:** `Authorization: Bearer $BITGET_QWEN_API_KEY` (never committed; `.env` is hook-blocked).
- **Decoding:** `temperature: 0` for reproducible verdicts.
- Client: `src/qwen.ts`. Gate logic: `src/convergenceGate.ts`. Demo: `src/gate-demo.ts`.

## The gate prompt

System prompt (`src/convergenceGate.ts`):

> You are a risk analyst for a tokenized-US-stock trading agent. The token trades 24/7 while the
> underlying US market is closed, so a gap is either (a) noise/sentiment that reverts at the open
> [fadeable] or (b) justified repricing from real overnight news [not fadeable]. Respond ONLY with
> compact JSON: `{"fadeable": boolean, "confidenceMultiplier": number 0..1, "rationale": string}`.

The user message carries symbol, session label, signed dislocation %, and the off-hours
news/context summary. The model returns JSON; `parseVerdict` tolerates prose around it.

## How the verdict feeds the trade

`effectiveMultiplier(verdict)` returns `confidenceMultiplier` when `fadeable`, else **0**.
That scalar multiplies the deterministic dislocation confidence before the risk governor
(`src/pipeline.ts`), so a "justified repricing" verdict **vetoes the trade** regardless of the
model's stated multiplier — the agent never fades real overnight news.

## Captured outcomes (`npm run gate-demo`)

Two off-hours gaps that look identical to the deterministic layer (both `rich`) but are not:

| Case | Session | Gap | Verdict | Effective × |
| --- | --- | --- | --- | --- |
| TSLAx — quiet weekend, broad crypto risk-on | weekend | +3.5% | `fadeable=true` | **×0.85** (fade the noise) |
| NVDAx — pre-announced earnings beat, targets raised | overnight | +6.0% | `fadeable=false` | **×0.00** (stand down) |

Re-capture: set `BITGET_QWEN_API_KEY` and run `npm run gate-demo`. The structured verdicts above
are stable at `temperature: 0`; the free-text `rationale` wording varies per call.
