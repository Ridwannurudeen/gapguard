# GapGuard — Roadmap

**Bitget AI Base Camp Hackathon S1 · Track 3 — US Stock AI Trading**
Reg deadline **Jun 14** · Submission window **Jun 15–25** · Results **Jun 30** (UTC+8).

**Build status: the `BUILD_PLAN.md` is 100% complete (all 8 items).** What remains is submission-side
and human-gated. 43 tests pass on `main`; typecheck clean.

---

## ✅ Done

- **Engine** (`src/`, on `main`): market clock + NYSE 2026 calendar, dislocation (z-scored gap in
  volatility units), proxy-return fair value (futures/sector-ETF blend, **damped by its own
  confidence** so a weak blend can't swing fair value), risk governor (confidence sizing, off-hours
  cap, drawdown breaker, rebalance deadband), `decide()` pipeline, replay demo (`npm run demo`,
  now with a per-rebalance fee + slippage haircut).
- **LLM convergence gate** (`src/convergenceGate.ts` + `src/qwen.ts`, `npm run gate-demo`):
  Qwen classifies an off-hours gap as fadeable noise vs justified repricing; live-proven
  (weekend noise → fade, earnings beat → stand down).
- **Tamper-evident glass-box** (`src/glassbox.ts`): append-only audit trail, sha256 hash-chained
  (`prevHash`/`recordHash` + `verifyChain()`); altering any past decision breaks verification.
- **Website** (`web/`): zero-dependency static site — landing page, how-it-works, and the cockpit
  (`web/cockpit.html`) — a control-tower view of a run that
  **re-verifies the hash chain in the browser** (SubtleCrypto) and has a live "simulate tampering"
  toggle. Auto-loads when served; drag-drop fallback for `file://`.
- **Stock-perp hedge router** (`src/instruments.ts` + `src/hedgeRouter.ts`, `npm run hedge-demo`):
  routes each decision to Bitget's real instruments — a long rests on the spot xStock, a short
  routes to the matching USDT-M stock perp (`TSLAUSDT`) because the token can't be shorted.
- **Bitget Playbook integration — proven end-to-end** (`playbook/`): ACCESS-KEY works;
  upload → run → real TSLA backtest logged in GetAgent cloud
  (`strategy_id 778f2bd9-149a-42af-87bc-35ee231c1f17`). Metrics on 252 real daily TSLA bars
  (2024-01-01 → 2025-12-31): **Sharpe 1.96 · win rate 75% · 40 trades · profit factor 3.48**.

## 🧱 Platform ceilings (documented, not pursued — not fixable from our package)

- **Tokenized stock is spot-only.** Bitget xStocks (`TSLAx`, …) trade buy-or-flat on Onchain/Wallet
  with no native short; to fade a "rich" gap the agent routes to the USDT-M stock perp. Verified
  against Bitget docs (June 2026).
- **Open-during-closure is unconfirmed.** Bitget freezes the perp mark to an EMA during US-market
  closures, and its docs conflict on whether a *new* perp can be opened then — the one runtime check
  a live off-hours hedge must confirm. The router surfaces this as a `closureCaveat` flag.
- **Managed backtest is crypto-only.** The platform's managed bootstrap routes by
  `manifest.market_type` (`spot`/`contract`, both crypto) and fetches `/crypto/spot/kline`
  even for `TSLA.NASDAQ` → run carries a `failed` flag. Our author-side `backtest.run()`
  still executes and logs the real metrics above. No equity instrument kind / market_type
  / data-source field exists.
- **Daily-bar fidelity.** Intraday equity history isn't available on Playbook, so the daily
  backtest can't capture the intraday gap snap-back that is the live thesis. The daily run
  validates the reversion logic (PF 3.48, 75% win); absolute return is modest by design.

## 📋 Remaining (submission-side — all human-gated)

1. **Demo video (≤3 min)** *(Jun 12–14)* — lead with the cockpit + tamper toggle, then
   `npm run demo` (glass-box), `npm run gate-demo` (LLM gate), `npm run hedge-demo` (instrument
   routing), and the live Playbook run.
2. **#BitgetHackathon X thread** *(Jun 14–15)* — tag Bitget AI (dissemination award).
3. **Repo access** — currently private; make public or grant judge access before submit.
4. **Submit in the Jun 15–25 window** — demo link + repo + ≤200-word description.
   **No submission without explicit approval.**
5. **Artifact captures still open** (`docs/artifacts/`): GetAgent run screenshot + raw
   `metrics_output.json`; live `AI_USAGE.md` gate transcript needs `BITGET_QWEN_API_KEY` in env.

## Decisions

- **BTC parallel green-run: SKIPPED** — a crypto run on a 24/7 market contradicts the gap
  premise; the real TSLA run + glass-box sim already clear the verifiable-records gate.
- **Hedge router scope: deterministic only** — names Bitget's real instruments and routes the
  decision, but live API execution is not wired (no trading keys; open-during-closure unconfirmed).
