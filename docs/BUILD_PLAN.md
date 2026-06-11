# GapGuard — Build Plan (audit-driven, proof-first)

Execution checklist derived from the Track-3 audit, **reconciled against the real repo**
(every item below was verified against source on 2026-06-09). Call this plan to execute any tier.
Companion to `ROADMAP.md` (strategy/timeline) — this file is the *how*.

**North-star repositioning** (apply to all copy): GapGuard is a **gap-risk control tower for
tokenized U.S. stocks** — it watches session mismatch, estimates fair value, asks AI whether a
move is real news or noise, and produces a **risk-governed hedge / reduce / trade / stand-down**
decision with an auditable record. *Not* "an AI bot that shorts tokens."

Verify after every code change: `npm test && npm run typecheck && npm run demo`.
**Do not submit anything without explicit approval** (standing rule).

---

## Tier 1 — cheap, no-regret, verified-needed  ✅ DONE (2026-06-11)

- [x] **1. De-stale the README** (`README.md`)
  - Line ~41: `npm test # vitest — 31 tests` → **33 tests**.
  - Line ~28: Perception row claims live Agent Hub Skills — soften to "designed to consume
    Agent Hub macro/news context; *current* perception = `proxyReturn` blend + Qwen gate"
    (no live Agent Hub API calls are wired in `src/` — verified).
  - Line ~29: Playbook row "⏳ cloud run blocked on key↔UID binding" → **"✅ uploaded + run;
    real TSLA metrics logged (Sharpe 1.96 / 75% win / 40 trades / PF 3.48)"**.
  - Lines ~53-58 "Open step 1 (the gate)" + Telegram-admin/key language → **delete** (resolved;
    key is the GetAgent ACCESS-KEY, working).

- [x] **2. Reposition copy** (`README.md` intro + `docs/SUBMISSION.md`)
  - Lead both with the gap-risk-control-tower framing above.
  - Execution narrative: **hedge / reduce / trade / stand-down**, not "short the token"
    (tokenized spot is `signal_only`; shorting needs the stock-perp path — see Tier 2 #7).

- [x] **3. Use proxy confidence** (`src/pipeline.ts:48-50`)
  - Today: `tick.proxySignals ? estimateProxyReturn(tick.proxySignals).proxyReturn : tick.proxyReturn`
    — `.confidence` is computed (`proxyReturn.ts:57`) then discarded.
  - Fix: capture the full `ProxyEstimate`; **dampen the applied return by its confidence**
    (`appliedProxyReturn = proxyReturn * confidence`) so a scattered/low-coverage blend can't
    swing fair value at full strength. Keep `tick.proxyReturn` path (no confidence) unchanged.
  - Add a `pipeline`/`proxyReturn` test: low-confidence signals move `fairValue` less than
    high-confidence ones for the same raw `proxyReturn`.

- [x] **4. Add a cost haircut to the demo** (`src/replay.ts:71`)
  - Today equity is marked by pure price move: `exposure * ((tokenPrice - prevPrice)/prevPrice)`.
  - Subtract a per-rebalance cost on `|Δexposure|` (fee + spread/slippage, e.g. 5–10 bps,
    reuse the `maker_fee`/`taker_fee` already in `playbook/backtest.yaml`). Print a "costs" column.
  - Goal: PnL stops looking suspiciously clean; still synthetic, but honest.

- [x] **5. Capture real artifacts + AI usage**
  - `docs/artifacts/` : Playbook `strategy_id 778f2bd9-149a-42af-87bc-35ee231c1f17`,
    `run_id pbrun-6bb44c13d8b7`, the `metrics_output` JSON, and a screenshot of the GetAgent run.
  - `AI_USAGE.md` : Qwen convergence gate — model, endpoint, the gate prompt, and a captured
    `npm run gate-demo` transcript (weekend-noise → fade vs earnings-beat → stand-down).
    Needs `BITGET_QWEN_API_KEY` in env to re-capture (never commit the key; `.env` is hook-blocked).

---

## Tier 2 — bigger builds (decide before starting)

- [ ] **6. Judge dashboard / cockpit** *(highest demo-score leverage; net-new build)*
  - One view: session badge · token price · fair value · gap (z-score) · Qwen verdict ·
    risk action · live JSONL feed. Drives the `decide()` loop over the replay scenario.
  - Decide: lightweight static HTML reading `glassbox-demo.jsonl`, vs a small Vite/React app.

- [x] **7. Tamper-evident glass-box** ✅ DONE (2026-06-11) (`src/glassbox.ts`)
  - `DecisionRecord` is appended verbatim (`formatRecord = JSON.stringify`, append-only).
  - Add `prevHash` + `recordHash` (sha256 over canonical record + prevHash) in `GlassBox.record()`
    via `node:crypto`; expose a `verifyChain()`. Stamp repo commit + run timestamp in a header line.
  - Upgrades "glass-box" from *transparent* to *verifiable*.

- [ ] **8. Stock-perp hedge loop** *(thesis-completing, largest)*
  - When the product can't short tokenized spot, route the risk decision to a stock-perp hedge.
  - Requires naming the exact Bitget instrument model (tokenized spot vs stock perp) — see
    Bitget U.S.-stock guide / Onchain support / Wallet xStocks guide.

---

## Known platform ceilings (do NOT spend time fighting — documented in ROADMAP.md)
- Managed Playbook backtest is **crypto-only** → equity run carries a `failed` flag despite real
  logged metrics. No equity `market_type`/`kind`/data-source field exists.
- Intraday equity history unavailable on Playbook → daily-bar backtest understates the intraday edge.

## Submission gates (Jun 15–25 window)
- [ ] Repo public or judge access granted.
- [ ] Demo video ≤3 min · #BitgetHackathon X thread tagging Bitget AI.
- [ ] Final submit — **approval-gated**.
