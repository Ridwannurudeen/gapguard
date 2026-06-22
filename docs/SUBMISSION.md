# GapGuard — Submission Pack

**Bitget AI Base Camp Hackathon S1 — Track 3: US Stock AI Trading**

Submission window: **Jun 15 – Jun 25, 2026 (UTC+8)**. Submit the public GitHub repo (or login-free demo) plus the project description below. Do not submit without explicit approval.

---

## Project Description

### Problem
Tokenized US stocks on Bitget (RWA perps like `AAPLUSDT`, `NVDAUSDT`, `TSLAUSDT`) trade **24/7**, but the underlying US market is open only ~6.5h/weekday. Off-hours, the token price dislocates from fair value; some of that move is **fadeable noise** that reverts at the US open, and some is **justified repricing** (an earnings beat, a Fed surprise) that keeps going. The hard part is not seeing the gap — it's *judging which kind it is*, in real time, over unstructured overnight news. Getting it wrong is how naive bots blow up. And separately: **why would anyone trust an autonomous agent with capital on this?**

### Thesis (core strategy logic)
Fade an outsized overnight gap on a tokenized US stock **only when the move looks like noise**, stand aside when it looks news-justified, size by conviction under a hard risk governor, and **make every decision verifiable**. An always-fade baseline has no edge (we show this with a real backtest); the agent's contribution is the *judgment* about when to fade, plus the discipline and auditability around it.

### How it works
- **Perception** — live, read-only Bitget RWA data: `futures_get_contracts` (`isRwa=YES`), ticker, funding, spread, min size (`npm run rwa:check`), plus a deterministic off-hours **dislocation** estimate from the US-session clock (`src/marketClock.ts` + `nyseCalendar2026.ts`).
- **Decision** — **Quorum**, a five-role adversarial desk (Narrative, Positioning, Market-Intel, Bear, Risk). In the current public Arena artifact, Quorum is a deterministic, evidence-weighted scenario: well-cited opinions count more, hand-wavy ones are discounted, a grounded Bear can outweigh weakly-supported longs, and a Bear or Risk **veto forces flat**. A naive momentum bot decides the *same* scenario, over-sizes, ignores conflicting evidence, and **records a mandate breach** -> it is **rejected**; Quorum is **paper-only** because the walk-forward RWA alpha certification is now positive but the live-license checklist still needs one more real Demo paper fill. Live LLM judgment is claimed only in the explicitly named Qwen gate/audit path.
- **Risk** — a natural-language **mandate** compiled into hard vetoes (max position, overnight drawdown cap, flat-before-open), enforced in code.
- **Execution** — a deterministic **sim broker** for offline RWA reproducibility, and a real **Bitget Agent Hub** path proven on Demo Trading with a crypto perp (see *Honest limitations* for why no live on-exchange stock fill is claimed).
- **Trust** — every decision, mandate ruling, breach, passport, and order is sealed into a **sha256 hash chain** (`public/arena-chain.jsonl`) that a judge **re-verifies in the browser** (`public/arena.html`, SubtleCrypto) with a **"simulate tampering"** toggle that flags the exact broken row. The whole ledger is then summarized by a **Merkle root signed with Ed25519** (`public/arena-attestation.json`) — attribution + a compact "verify, don't trust" fingerprint aligned with MiFID II / EU AI Act Art. 12 / SEC CAT audit norms.

### Completeness (honest self-assessment)
End-to-end MVP runs today: read-only live RWA perception, the deterministic evidence-weighted Quorum scenario, the risk mandate, the RWA sim broker plus crypto Demo execution proof, the verifiable chain + signed Merkle attestation + cockpit, reproducible AAPLUSDT backtests, a broader 20-symbol RWA sample, and a locked walk-forward alpha certification. The single-symbol always-fade baseline is ~flat, the broader 790-trade always-fade basket is negative, and the live Qwen gate-driven AAPL backtest is **+1.3%** because, on real blinded Finnhub news, the gate correctly stands aside on the WWDC catalyst the always-fade baseline loses on. The new `npm run alpha:certify` artifact changes the evidence: a selective RWA gap-follow rule, using only prior same-direction outcomes, clears the out-of-sample window with 119 trades, +3.785% return, Sharpe 6.511, PF 2.20, versus -5.471% for OOS always-fade. Quorum is still `PAPER_ONLY` in the generated Arena because only 2 real Demo paper fills are recorded; the system will not issue `LICENSED` until the third Demo fill is present. No live on-exchange *stock* fill is claimed (not possible on Bitget Demo — see below).

---

## Track-3 evidence

| Required material | What we provide |
| --- | --- |
| **Public GitHub repo + README** | This repo (public), README with install + run + integration. |
| **Login-free demo** | `public/arena.html` cockpit (static; in-browser chain verification + tamper toggle) + a signed Merkle attestation (`public/arena-attestation.json`). |
| **Paper trading log** (ts / asset / direction / price / qty / balance change) | `artifacts/aaplusdt-backtest.json` — deterministic sim/backtest per-trade log on real public `AAPLUSDT` RWA-perp candles **with all required fields**; plus `artifacts/paper-btc-smoke.jsonl` — a **real Bitget Demo crypto fill** (orderId + balance delta) proving the execution path. |
| **Backtest report** (optional; code required) | Five honest reports: (a) `npm run backtest` — deterministic `AAPLUSDT` gap reversion on real public Bitget candles (no key), output `artifacts/aaplusdt-backtest.json`; (b) `npm run backtest:multi` — 20-symbol public RWA basket, output `artifacts/rwa-multi-backtest.json`; (c) `npm run alpha:certify` — locked walk-forward RWA certification, output `artifacts/rwa-alpha-certification.json`; (d) a **platform-certified Bitget Playbook managed run** (`playbook/`, run `pbrun-e3fe0ec8c873`, completed) → `playbook/aaplusdt-backtest-result.json`; (e) `npm run backtest:news` — label baseline plus cached Qwen gate-driven metrics from `data/aaplusdt-gate-verdicts.json`. |

**Backtest result (real `AAPLUSDT` 1H, 27 sessions, honest):** total return **−0.397%**, Sharpe **−0.181**, max DD **3.302%**, win **40%**, 15 trades, PF **0.95**, after the spread-derived slippage stress in `artifacts/aaplusdt-backtest.json`. This is the **always-fade baseline** — it confirms blindly fading every gap has *no* standalone edge, which is exactly why GapGuard adds the convergence gate + risk governor. Small sample; not statistically significant; presented as a baseline, not a headline.

**Platform-certified managed backtest (Bitget Playbook, run `pbrun-e3fe0ec8c873`, status `completed`):** the `AAPLUSDT` RWA-perp package ran end-to-end on Bitget's managed Nautilus engine on real `exchange=bitget` data — **total return −0.018%, Sharpe −1.05, max DD 0.053%, win 42.1%, 38 trades (19 positions), profit factor 1.06** (`playbook/aaplusdt-backtest-result.json`). Same honest ~flat finding, now **platform-certified on a real tokenized US stock** — and the first completed managed run for this project (the US-equity package can't get one; the RWA-perp `exchange=bitget` path does).

**Broader RWA basket (`npm run backtest:multi`):** 20 public Bitget RWA symbols over the 1H historical window produced **790 trades**, total return **−8.233%**, annualized Sharpe **−6.704**, win **44.1%**, PF **0.73** (`artifacts/rwa-multi-backtest.json`), after spread-derived slippage. This is the evidence-backed warning: blindly fading every tokenized-stock gap does not work at scale.

**Walk-forward RWA alpha certification (`npm run alpha:certify`):** the rule is locked before the OOS pass: follow, not fade, an RWA gap only when the last 80 same-direction RWA gap-follow outcomes have at least 40 observations, positive mean return, and at least 55% wins. The first 60% of unique gap dates are formation history; later dates are out-of-sample. Current result: **119 OOS trades, +3.785%, Sharpe 6.511, win 59.7%, PF 2.20**, versus **−5.471%** for OOS always-fade (`artifacts/rwa-alpha-certification.json`). This is the passport alpha evidence; it is still an 83-day sample and not a live-fill claim.

**News-aware / gate-driven backtest (`npm run backtest:news`):** the true AI-backed variant reads `data/aaplusdt-gate-verdicts.json`, produced by `BITGET_QWEN_API_KEY=<key> npm run gate:audit`. On **real, blinded Finnhub overnight headlines** (`npm run news:fetch`), Qwen scored **12/15 (80%)** and — critically — **correctly stood aside on the 2026-06-09 WWDC** catalyst (it read *"Apple's $75 AI Moment at WWDC"* and judged it justified repricing). That turns the **−0.475%** always-fade baseline into **+1.346%** over 13 trades — a genuine, non-circular demonstration that the AI's news judgment adds value. **Honest caveat:** n=15 and the lift is driven mainly by the one catalyst the gate correctly caught; the 3 misses are macro days (jobs/FOMC). A separate +1.793% label-grounded catalyst baseline is reported as a baseline, not the AI edge.

**Live gate audit (`npm run gate:audit`, needs `BITGET_QWEN_API_KEY` to regenerate):** the audit feeds Qwen only blinded overnight news summaries from `data/aaplusdt-news-contexts.json` — now **real Finnhub company-news headlines** published before each session open (`npm run news:fetch`), not hand-curated; expected fade/stand-aside labels live separately in `data/aaplusdt-gate-labels.json` and are used only after the model returns. All 15 AAPL backtest gaps are scored, and the committed run writes both `artifacts/aaplusdt-gate-audit.json` and `data/aaplusdt-gate-verdicts.json` for the gate-driven backtest.

---

## Executable proof commands

```bash
npm install
npm test                 # 109 tests, typecheck-clean
npm run backtest         # real AAPLUSDT gap-reversion backtest (no key) -> metrics + per-trade log
npm run backtest:multi   # 20-symbol RWA basket: broader always-fade baseline
npm run alpha:certify    # locked walk-forward RWA alpha certification
npm run backtest:news    # label baseline + cached Qwen gate-driven metrics
BITGET_QWEN_API_KEY=<key> npm run gate:audit   # blinded Qwen gate over all 15 AAPL gaps
npm run arena:demo       # passport, Quorum decision, Naive breach, sim fill, arena-chain.jsonl
npm run arena:keygen     # one-time: local private key + public/arena-pubkey.pem
npm run arena:cockpit    # build arena-data.json + arena-chain.jsonl + signed Merkle arena-attestation.json
npm run rwa:check        # live public Bitget RWA contract/ticker/spread/min-size evidence
npm run verify-log       # recompute + verify the hash chain
# (optional) open public/arena.html -> Verify chain, then Simulate tampering
```

Key generated artifacts: `artifacts/aaplusdt-backtest.json` (backtest + paper log), `artifacts/rwa-multi-backtest.json` (20-symbol baseline), `artifacts/rwa-alpha-certification.json` (walk-forward alpha certification), `artifacts/paper-btc-smoke.jsonl` (real Demo fill), `public/arena-chain.jsonl` (verifiable chain), `public/arena.html` (cockpit), `public/rwa-market.json` (live RWA evidence).

---

## Demo-video script (≤3 min)

| Time | Visual | Narration |
| --- | --- | --- |
| 0:00–0:20 | `public/arena.html` | "GapGuard evaluates the off-hours gap on tokenized US stocks — and makes the agent earn a license before anything leaves simulation." |
| 0:20–0:55 | Quorum five-role decision | "Five deterministic roles argue the same AAPLUSDT gap. Evidence-weighted consensus sizes the simulated trade; a Bear or Risk veto forces flat." |
| 0:55–1:25 | Naive bot rejected | "A naive momentum bot sees the same path, over-sizes, breaches its drawdown mandate — and is rejected." |
| 1:25–1:55 | `npm run backtest` + `rwa:check` | "Real Bitget AAPLUSDT data: a reproducible gap-reversion backtest and live RWA market evidence." |
| 1:55–2:25 | Arena chain verify + tamper | "The cockpit recomputes the decision chain in your browser. Toggle tampering — the exact broken row turns red." |
| 2:25–3:00 | Crypto Demo fill + boundary | "The exchange path is proven with a Bitget Demo crypto fill; the RWA stock leg is sim/backtest until explicit live approval. GapGuard: judge the gap, earn trust, then trade." |

---

## Honest limitations (state these plainly)
1. **No live on-exchange *stock* fill.** Bitget **Demo Trading lists crypto perps only** (verified) — RWA stock perps are live-only. So our *real* on-exchange fill is on `BTCUSDT` (proof the execution path works); the **stock** trading evidence is the simulated RWA ledger + the AAPLUSDT backtest. Sim/backtest records are explicitly accepted by the rules.
2. **Naive baselines are flat-to-negative.** Reported truthfully. The broader 20-symbol always-fade sample is negative; the positive claim is narrower: a locked walk-forward selective gap-follow certification over the OOS window.
3. **Managed backtest: COMPLETED + certified on the `AAPLUSDT` RWA perp** (run `pbrun-e3fe0ec8c873`, `playbook/aaplusdt-backtest-result.json`). The US-*equity* path (`TSLA.NASDAQ`) is still blocked by Bitget's equity-data ceiling, but the RWA-perp `exchange=bitget` kline path runs end-to-end — so we claim a real certified managed run, on a tokenized US stock, with the honest ~flat result. Not published (publish is approval-gated).
4. **LLM verdicts are cached before backtesting.** The deterministic baseline stays no-LLM; the gate-driven variant only uses a committed verdict cache from `gate:audit`, so results are reproducible after the one live Qwen pass.

---

## Pre-submission checklist
- [x] Public repo + runnable README (install → test → backtest → arena)
- [x] Reproducible AAPLUSDT backtest with code (`npm run backtest`)
- [x] Track-3 paper-trading log with required fields (`artifacts/aaplusdt-backtest.json` sim/backtest log + real crypto Demo `paper-btc-smoke.jsonl`)
- [x] Read-only live RWA perception evidence (`npm run rwa:check` → `public/rwa-market.json`)
- [x] Verifiable Arena chain + in-browser tamper demo (`public/arena.html`)
- [x] 109 tests + typecheck green
- [ ] Confirm registered **UID** matches submission (verify against registration email)
- [ ] Record ≤3-min demo video (optional but recommended)
- [ ] Publish dissemination thread (#BitgetHackathon, @Bitget_AI, quote the official post) — Community Impact Award
- [x] Platform-certified AAPLUSDT managed backtest completed (`pbrun-e3fe0ec8c873`) and wired in
- [ ] Submit via the official form link **only after explicit approval**
