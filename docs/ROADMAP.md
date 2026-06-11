# GapGuard — Roadmap

**Bitget AI Base Camp Hackathon S1 · Track 3 — US Stock AI Trading**
Reg deadline **Jun 14** · Submission window **Jun 15–25** · Results **Jun 30** (UTC+8).

---

## ✅ Done

- **Engine** (`src/`, on `main`, 33 tests pass): market clock + NYSE 2026 calendar, dislocation
  (z-scored gap in volatility units), proxy-return fair value (futures/sector-ETF blend),
  risk governor (confidence sizing, off-hours cap, drawdown breaker, rebalance deadband),
  glass-box audit log, `decide()` pipeline, replay demo (`npm run demo`).
- **LLM convergence gate** (`src/convergenceGate.ts` + `src/qwen.ts`, `npm run gate-demo`):
  Qwen classifies an off-hours gap as fadeable noise vs justified repricing; live-proven
  (weekend noise → fade, earnings beat → stand down).
- **Bitget Playbook integration — proven end-to-end** (`playbook/`): ACCESS-KEY works;
  upload → run → real TSLA backtest logged in GetAgent cloud
  (`strategy_id 778f2bd9-149a-42af-87bc-35ee231c1f17`). Metrics on 252 real daily TSLA bars
  (2024-01-01 → 2025-12-31): **Sharpe 1.96 · win rate 75% · 40 trades · profit factor 3.48 ·
  max drawdown 3.46%**.

## 🧱 Platform ceilings (documented, not pursued — not fixable from our package)

- **Managed backtest is crypto-only.** The platform's managed bootstrap routes by
  `manifest.market_type` (`spot`/`contract`, both crypto) and fetches `/crypto/spot/kline`
  even for `TSLA.NASDAQ` → run carries a `failed` flag. Our author-side `backtest.run()`
  still executes and logs the real metrics above. No equity instrument kind / market_type
  / data-source field exists.
- **Daily-bar fidelity.** Intraday equity history isn't available on Playbook, so the daily
  backtest can't capture the intraday gap snap-back that is the live thesis. The daily run
  validates the reversion logic (PF 3.48, 75% win); absolute return is modest by design.

## 📋 Remaining

1. **Submission pack** (`docs/SUBMISSION.md`) — real metrics + honest limitation note. *(done alongside this roadmap)*
2. **Demo video (≤3 min)** *(Jun 12–14)* — `npm run demo` (glass-box) + `npm run gate-demo`
   (LLM gate) + the live Playbook run. Lead with risk governor + glass-box + LLM gate.
3. **#BitgetHackathon X thread** *(Jun 14–15)* — tag Bitget AI (dissemination award).
4. **Repo access** — currently private; make public or grant judge access before submit.
5. **Submit in the Jun 15–25 window** — demo link + repo + ≤200-word description.
   **No submission without explicit approval.**

## Decisions

- **BTC parallel green-run: SKIPPED** — a crypto run on a 24/7 market contradicts the gap
  premise; the real TSLA run + glass-box sim already clear the verifiable-records gate.
