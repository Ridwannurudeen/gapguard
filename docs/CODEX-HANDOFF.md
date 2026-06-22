# Codex Handoff — GapGuard limitations to fix ASAP

**Context:** GapGuard = AI agent trading the off-hours gap on tokenized US stocks + a verifiable trust layer. Bitget AI Hackathon S1, **Track 3**, going for the grand prize. Submission deadline **Jun 25, 2026 (UTC+8)**. Default branch is `main` (protected — work on a feature branch, then `gh pr create --base main` + merge). Live at https://gapguard.gudman.xyz. 93 tests green, typecheck clean.

**Honest verdict from the audit:** strong engineering + narrative + honest self-labeling, but the *proof of a working AI stock-trading strategy is thin*. The fixes below are ordered by how much they close that gap. **Do not p-hack numbers, do not fake live trades, and keep the honest framing — it's an asset.** Every file path below was verified against the current tree.

---

## P0 — highest credibility impact, fixable before deadline

### P0-1. The "+1.87% AI edge" has NO AI in it — wire the gate into the backtest
**Problem:** `src/backtest.ts` and `src/newsBacktest.ts` import nothing from the desk/gate/Qwen (verified). The headline +1.87% comes from **hand-labeled catalyst dates** in `data/aaplusdt-catalysts.json`, not from the AI deciding anything. So the number we market as "the AI's measured edge" is human-labeled, not AI-driven.
**Fix:**
1. Add a backtest path where the **convergence gate decides fade-vs-stand-aside per gap**. Because the gate is an LLM (`src/convergenceGate.ts` + `src/qwen.ts`, live-only/non-deterministic), run it **once** over the historical gaps, **cache the verdicts to a committed JSON** (e.g. `data/aaplusdt-gate-verdicts.json`), then have `newsBacktest.ts` consume the cached verdicts instead of `aaplusdt-catalysts.json`.
2. Report the gate-driven return alongside the always-fade baseline. If it's still flat/negative, **say so** — but at least the number is then genuinely AI-produced.
**Before deadline?** YES. Needs the Qwen key (env `BITGET_QWEN_API_KEY`).

### P0-2. The 11/11 gate audit is circular — stop feeding it the answer key
**Problem:** `src/gateAudit.ts` feeds the gate the **catalyst fact itself** ("WWDC keynote happened") for catalyst days and "quiet session" for the rest, then scores 11 of 15 (4 dropped as ambiguous). 10/11 are trivial "no-news → fade"; the one hard call (WWDC) had the answer handed to it. So 100% proves nothing about the AI finding news on its own.
**Fix:** feed the gate a **realistic overnight news summary it did not get the label from** — pull from a real news source / the Agent Hub news-briefing for each date, or at minimum a blinded summary. Score **all** gaps, not a filtered subset. Report the real (probably <100%) accuracy honestly.
**Before deadline?** YES if a news source is wired; otherwise downgrade the claim and disclose the circularity.

### P0-3. Sample is an anecdote — broaden tickers + window
**Problem:** the backtest is **15 trades, ~6 weeks, one ticker (AAPLUSDT)**. The entire +1.87% lift = avoiding **2 trades** (WWDC −1.96%, May-18 −0.18%) — verified in `artifacts/aaplusdt-news-aware-backtest.json`. Statistically meaningless.
**Fix:** fetch more data via `scripts/fetch-aaplusdt.mjs` (extend to NVDAUSDT, TSLAUSDT, etc. + a longer window / smaller granularity), run the backtest across all of them, report aggregate stats with n in the hundreds. Keep the per-ticker honesty caveats.
**Before deadline?** YES — cheapest high-impact fix. No key needed (public candles).

---

## P1 — real integrity, fixable with effort

### P1-1. The desk runs on hardcoded fixtures, not live data
**Problem:** `src/arenaScenario.ts` (215 lines) is **hand-written opinions**; `src/arena-demo.ts` feeds them to `decideQuorum`. So "five AIs debating" is, in the shipped artifact, five static objects passed to a scoring function — not a debate over real market state.
**Fix:** generate at least one **end-to-end run** where Quorum opinions are derived from **real perceived signals** (dislocation from `src/dislocation.ts`, funding/spread from `src/rwa-market.ts`, news from the gate). Even one real perception→desk→decision path makes the "adversarial desk" claim true rather than scripted.
**Before deadline?** PARTIAL — at least wire one live path; full live desk may not finish.

### P1-2. The "signed" attestation uses an ephemeral key (no identity)
**Problem:** `src/arena-cockpit.ts:226` calls `attestChain(...)` with **no `privateKey`**, so `src/arena-chain.ts:126` generates a **fresh Ed25519 keypair every run**. The signature proves a run self-signed itself, but there's no stable identity — re-signing tampered data with a new key would also "verify." The MiFID/SEC-CAT framing oversells this.
**Fix:** load a **persistent** signing key from env (`ARENA_SIGNING_KEY`) and **commit the public key** (`public/arena-pubkey.pem`) so verifiers check against a known identity. Update the cockpit caller + the in-browser/Node verify to check against the published pubkey. Document the threat model honestly (the hash chain is the tamper-evidence; the signature is attribution).
**Before deadline?** YES — small, self-contained.

### P1-3. Backtest fills are optimistic — model slippage/liquidity
**Problem:** `src/gapEngine.ts` enters at the **session-open price** and exits at the **close** with a flat **5bps/side**. No slippage/liquidity modeling; off-hours tokenized-stock liquidity is ~70% thinner (per research). Entering exactly at the open is unrealistic.
**Fix:** model slippage as a function of the real spread (from `rwa-market.json`); optionally enter one bar after the open; show results under a stress-cost assumption. If the edge dies under realistic costs, disclose it.
**Before deadline?** YES — deterministic, no key.

---

## P2 — hard or disclose-only (do NOT fake)

### P2-1. Zero real tokenized-stock trades
The only real on-exchange fill is **BTCUSDT** (crypto, demo) — `artifacts/paper-btc-smoke.jsonl`. Bitget Demo has no RWA stock perps; a live stock fill needs real funds + a live key (approval-gated). **DISCLOSE** unless the user provides a funded live RWA key. Do not fabricate.

### P2-2. The strategy is flat-to-negative
Certified managed run (`playbook/aaplusdt-backtest-result.json`): **return −0.018%, Sharpe −1.05, win 42%, 38 trades**. A negative Sharpe is a losing risk-adjusted result. Can't be manufactured — either P0-1/P0-3 surface a real edge, or keep framing the value as *system + verifiability + honesty*, not returns. **DISCLOSE.**

### P2-3. The thesis premise is half-verified
"Off-hours reversion is a documented edge" rests on an SSRN paper whose **full body could not be loaded (403)** — we have the abstract only. Either obtain the paper and confirm the exact claim, or stop citing it as proof and call it a hypothesis.

---

## Guardrails for Codex
- **Keep the honesty.** The submission's self-labeling of limits is a strength with expert judges. Don't trade it for inflated numbers.
- **No p-hacking, no fake trades, no cherry-picked windows.** If a fix makes the result worse, report the worse result.
- **Tests:** add tests for any new backtest path (gate-driven, multi-ticker) and the persistent-key verify. Keep `npm test` + `npm run typecheck` green.
- **Branch flow:** feature branch → `gh pr create --base main` → `gh pr merge --merge`. Don't commit to `main` directly (hook-blocked).

## Quick reference
- Backtests: `npm run backtest`, `npm run backtest:news`, `BITGET_QWEN_API_KEY=… npm run gate:audit`
- Data: `data/aaplusdt-1h.json` (committed), regen `npm run backtest:fetch`; labels `data/aaplusdt-catalysts.json`
- Artifacts: `artifacts/aaplusdt-news-aware-backtest.json`, `artifacts/aaplusdt-gate-audit.json`, `playbook/aaplusdt-backtest-result.json`
- Key code: `src/backtest.ts`, `src/newsBacktest.ts`, `src/gapEngine.ts`, `src/gateAudit.ts`, `src/convergenceGate.ts`, `src/quorum.ts`, `src/arenaScenario.ts`, `src/arena-demo.ts`, `src/arena-chain.ts`, `src/arena-cockpit.ts`, `src/liveStockBroker.ts`
