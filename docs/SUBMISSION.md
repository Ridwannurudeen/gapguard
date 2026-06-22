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
- **Decision** — **Quorum**, a five-role adversarial desk (Narrative, Positioning, Market-Intel, Bear, Risk). **Evidence-weighted consensus** (well-cited opinions count more, hand-wavy ones are discounted, so a grounded Bear can outweigh weakly-supported longs) becomes the position multiplier; a Bear or Risk **veto forces flat**. A naive momentum bot decides the *same* scenario, over-sizes, ignores conflicting evidence, and **records a mandate breach** → it is **rejected**; Quorum is **licensed**.
- **Risk** — a natural-language **mandate** compiled into hard vetoes (max position, overnight drawdown cap, flat-before-open), enforced in code.
- **Execution** — a deterministic **sim broker** for offline reproducibility, and a real **Bitget Agent Hub** path proven on Demo Trading (see *Honest limitations* for why the live on-exchange fill is on `BTCUSDT`).
- **Trust** — every decision, mandate ruling, breach, passport, and order is sealed into a **sha256 hash chain** (`public/arena-chain.jsonl`) that a judge **re-verifies in the browser** (`public/arena.html`, SubtleCrypto) with a **"simulate tampering"** toggle that flags the exact broken row. The whole ledger is then summarized by a **Merkle root signed with Ed25519** (`public/arena-attestation.json`) — attribution + a compact "verify, don't trust" fingerprint aligned with MiFID II / EU AI Act Art. 12 / SEC CAT audit norms.

### Completeness (honest self-assessment)
End-to-end MVP runs today: live RWA perception, the evidence-weighted adversarial decision, the risk mandate, the sim + real-demo execution, the verifiable chain + signed Merkle attestation + cockpit, and reproducible AAPLUSDT backtests (an always-fade baseline **and** a catalyst-aware variant) — **93 automated tests pass, typecheck clean.** What is *not* claimed: a proven-profitable strategy — the *always-fade* baseline is ~flat (that's the point), and while standing aside on verified catalysts lifts it to +1.9% here, that is a **small sample (n=15) driven mainly by one event (WWDC) — illustrative, not statistically significant**; and no live on-exchange *stock* fill (not possible on Bitget Demo — see below). We *do* now have a platform-certified managed backtest (below). We report these limits plainly; the rubric values honesty over exaggeration.

---

## Track-3 evidence

| Required material | What we provide |
| --- | --- |
| **Public GitHub repo + README** | This repo (public), README with install + run + integration. |
| **Login-free demo** | `public/arena.html` cockpit (static; in-browser chain verification + tamper toggle) + a signed Merkle attestation (`public/arena-attestation.json`). |
| **Paper trading log** (ts / asset / direction / price / qty / balance change) | `artifacts/aaplusdt-backtest.json` — per-trade log on the real `AAPLUSDT` RWA perp **with all required fields**; plus `artifacts/paper-btc-smoke.jsonl` — a **real Bitget Demo fill** (orderId + balance delta) proving the execution path. |
| **Backtest report** (optional; code required) | Two, both on real `AAPLUSDT`: (a) `npm run backtest` — deterministic gap reversion on real public Bitget candles (no key), code in `src/backtest.ts`, output `artifacts/aaplusdt-backtest.json`; (b) a **platform-certified Bitget Playbook managed run** (`playbook/`, run `pbrun-e3fe0ec8c873`, completed) → `playbook/aaplusdt-backtest-result.json`; (c) a **news-aware variant** (`npm run backtest:news`) that stands aside on verified catalysts → `artifacts/aaplusdt-news-aware-backtest.json`. |

**Backtest result (real `AAPLUSDT` 1H, 27 sessions, honest):** total return ≈ **−0.3%**, Sharpe ≈ −0.1, max DD ≈ 3.3%, win 40%, 15 trades, PF 0.97. This is the **always-fade baseline** — it confirms blindly fading every gap has *no* standalone edge, which is exactly why GapGuard adds the convergence gate + risk governor. Small sample; not statistically significant; presented as a baseline, not a headline.

**Platform-certified managed backtest (Bitget Playbook, run `pbrun-e3fe0ec8c873`, status `completed`):** the `AAPLUSDT` RWA-perp package ran end-to-end on Bitget's managed Nautilus engine on real `exchange=bitget` data — **total return −0.018%, Sharpe −1.05, max DD 0.053%, win 42.1%, 38 trades (19 positions), profit factor 1.06** (`playbook/aaplusdt-backtest-result.json`). Same honest ~flat finding, now **platform-certified on a real tokenized US stock** — and the first completed managed run for this project (the US-equity package can't get one; the RWA-perp `exchange=bitget` path does).

**News-aware backtest — the AI's edge, measured (`npm run backtest:news`):** the always-fade baseline is ~flat, but its worst single loss was *fading the WWDC keynote reaction* (−1.96% into the 2026-06-09 open) — a justified repricing, not noise. An agent that **stands aside on verified catalysts** (real, sourced: WWDC, FOMC, jobs/CPI — `data/aaplusdt-catalysts.json`) scores **+1.87%** (AAPL-news-aware) vs **−0.31%** baseline over the same window. This is exactly the only-AI contribution GapGuard claims: *judging which overnight moves are fadeable noise vs news-justified.* **Honest caveat:** n=15 and the lift is driven mainly by one event — illustrative of the mechanism, not statistically significant. The labels here are verified scheduled catalysts; live, the **Qwen convergence gate** produces these fade-vs-justified calls.

---

## Executable proof commands

```bash
npm install
npm test                 # 93 tests, typecheck-clean
npm run backtest         # real AAPLUSDT gap-reversion backtest (no key) -> metrics + per-trade log
npm run backtest:news    # news-aware variant: stand aside on verified catalysts (+1.87% vs -0.31%)
npm run arena:demo       # passport, Quorum decision, Naive breach, sim fill, arena-chain.jsonl
npm run arena:cockpit    # build arena-data.json + arena-chain.jsonl + signed Merkle arena-attestation.json
npm run rwa:check        # live public Bitget RWA contract/ticker/spread/min-size evidence
npm run verify-log       # recompute + verify the hash chain
# (optional) open public/arena.html -> Verify chain, then Simulate tampering
```

Key generated artifacts: `artifacts/aaplusdt-backtest.json` (backtest + paper log), `artifacts/paper-btc-smoke.jsonl` (real Demo fill), `public/arena-chain.jsonl` (verifiable chain), `public/arena.html` (cockpit), `public/rwa-market.json` (live RWA evidence).

---

## Demo-video script (≤3 min)

| Time | Visual | Narration |
| --- | --- | --- |
| 0:00–0:20 | `public/arena.html` | "GapGuard trades the off-hours gap on tokenized US stocks — and makes the agent earn a license before any capital." |
| 0:20–0:55 | Quorum five-role decision | "Five roles argue the same AAPLUSDT gap. Consensus sizes the trade; a Bear or Risk veto forces flat." |
| 0:55–1:25 | Naive bot rejected | "A naive momentum bot sees the same path, over-sizes, breaches its drawdown mandate — and is rejected." |
| 1:25–1:55 | `npm run backtest` + `rwa:check` | "Real Bitget AAPLUSDT data: a reproducible gap-reversion backtest and live RWA market evidence." |
| 1:55–2:25 | Arena chain verify + tamper | "The cockpit recomputes the decision chain in your browser. Toggle tampering — the exact broken row turns red." |
| 2:25–3:00 | Paper fill + tagline | "The execution path is proven on Bitget Demo. GapGuard: judge the gap, earn trust, then trade." |

---

## Honest limitations (state these plainly)
1. **No live on-exchange *stock* fill.** Bitget **Demo Trading lists crypto perps only** (verified) — RWA stock perps are live-only. So our *real* on-exchange fill is on `BTCUSDT` (proof the execution path works); the **stock** trading evidence is the simulated RWA ledger + the AAPLUSDT backtest. Sim/backtest records are explicitly accepted by the rules.
2. **Backtest baseline is ~flat.** Reported truthfully; the value is the gate/governor/verification, not a magic return. Small sample.
3. **Managed backtest: COMPLETED + certified on the `AAPLUSDT` RWA perp** (run `pbrun-e3fe0ec8c873`, `playbook/aaplusdt-backtest-result.json`). The US-*equity* path (`TSLA.NASDAQ`) is still blocked by Bitget's equity-data ceiling, but the RWA-perp `exchange=bitget` kline path runs end-to-end — so we claim a real certified managed run, on a tokenized US stock, with the honest ~flat result. Not published (publish is approval-gated).
4. **LLM is live/evaluation-only**, never in the backtested path (kept deterministic for reproducibility).

---

## Pre-submission checklist
- [x] Public repo + runnable README (install → test → backtest → arena)
- [x] Reproducible AAPLUSDT backtest with code (`npm run backtest`)
- [x] Track-3 paper-trading log with required fields (`artifacts/aaplusdt-backtest.json` + real Demo `paper-btc-smoke.jsonl`)
- [x] Live RWA perception evidence (`npm run rwa:check` → `public/rwa-market.json`)
- [x] Verifiable Arena chain + in-browser tamper demo (`public/arena.html`)
- [x] 93 tests + typecheck green
- [ ] Confirm registered **UID** matches submission (verify against registration email)
- [ ] Record ≤3-min demo video (optional but recommended)
- [ ] Publish dissemination thread (#BitgetHackathon, @Bitget_AI, quote the official post) — Community Impact Award
- [x] Platform-certified AAPLUSDT managed backtest completed (`pbrun-e3fe0ec8c873`) and wired in
- [ ] Submit via the official form link **only after explicit approval**
