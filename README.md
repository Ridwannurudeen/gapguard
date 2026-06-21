# Agent Arena

A trading-agent licensing arena for the **Bitget AI Base Camp Hackathon S1 - Track 2 (Trading Infra)**, with GapGuard/Quorum as the flagship RWA stock-perp exhibit.

## The problem

Most autonomous trading-agent demos ask judges to trust a single LLM narrative. Agent Arena does the opposite: it makes agents earn a license before capital is unlocked. A candidate agent must show evidence, debate, risk controls, hash-chain verification, and a capped execution path. Weak or overconfident agents stay paper-only or get rejected.

GapGuard is now the flagship exhibit inside the Arena. Quorum, an adversarial desk, uses GapGuard's tokenized-stock gap-risk engine plus role-specialized debate to decide whether a tiny RWA perp fill has earned graduation from simulation.

## Architecture

| Module | Role | Status |
| --- | --- | --- |
| `src/marketClock.ts` | Classifies the US session; `underlyingOpen` gates the edge; computes the next open. | built + tested |
| `src/nyseCalendar2026.ts` | Verified 2026 NYSE equity calendar. | built |
| `src/dislocation.ts` | Estimates token vs fair-value gap in volatility units. | built + tested |
| `src/proxyReturn.ts` | Blends 24/7 proxy signals into an implied underlying return; weak confidence discounts the shift. | built + tested |
| `src/riskGovernor.ts` | Sizes by confidence/vol, caps off-hours exposure, realizes into reopen, and halts on drawdown. | built + tested |
| `src/glassbox.ts` | Hash-chained JSONL audit trail for tamper-evident decision records. | built + tested |
| `src/convergenceGate.ts` + `src/qwen.ts` | Qwen gate for fadeable gap vs justified repricing. | built + tested |
| `src/quorum.ts` | Five-role adversarial desk: narrative, positioning, market intel, bear, and risk opinions become consensus, veto status, and a position multiplier. | built + tested |
| `src/agentArena.ts` | Passport issuer. Grades candidates as `LICENSED`, `PAPER_ONLY`, or `REJECTED` from evidence and controls. | built + tested |
| `src/liveStockBroker.ts` | Agent Hub broker wrapper. Defaults to dry-run, supports paper trading, and blocks live orders unless licensed, confirmed, isolated, low-leverage, and capped. | built + tested |
| `src/arena-demo.ts` | Generates the Arena artifact with Quorum's passport, the rejected naive bot, the Quorum decision, and the dry-run order payload. | built |
| `src/arena-cockpit.ts` | Builds sanitized public cockpit data from the Arena artifact, paper-trade evidence, and GapGuard proof summary. | built + tested |
| `src/bitgetWalletApi.ts` | Bitget Wallet API signer/client using the documented HMAC flow. | built + tested |
| `src/bitgetProbe.ts` | Executable target-market probe for token info, K-lines, transaction info, and optional RWA quote routing. | built, blocked without API key |
| `public/arena.html` | Judge-facing Arena cockpit for license leaderboard, Quorum debate, broker rail, and proof stack. | built |
| `public/dashboard.html` | Static judge cockpit for replay outcome, proxy confidence, risk actions, and hash-chain verification. | built |
| `playbook/` | Bitget Playbook package for the ordinary-equity baseline. | authored + local validation passed |

## Tooling

- **Agent Hub** (`bgc` CLI + `bitget-mcp-server`) - order path, Demo Trading bridge, and live-order guardrail.
- **Bitget Playbook** (`@bitget-ai/getagent-skill`) - US-stock quant backtest/deploy baseline.
- **Qwen** (`qwen3.6-plus`) - optional convergence-gate reasoning.

## Develop

```bash
npm install
npm test
npm run typecheck
npm run demo        # replay data/tslax-replay.json and write glassbox-demo.jsonl + public/dashboard-data.json
npm run verify-log  # verify the hash chain in glassbox-demo.jsonl
npm run arena:demo  # write artifacts/agent-arena-demo.json
npm run arena:cockpit
npm run broker:order -- --mode dry_run
npm run broker:balance -- --mode paper
npm run probe:bitget

# Optional Qwen convergence gate:
BITGET_QWEN_API_KEY=<your-key> npm run gate-demo
```

`npm run arena:demo` writes:

- `artifacts/agent-arena-demo.json` - Quorum's licensed passport, the rejected naive bot, the five-agent Quorum decision, and the dry-run `bgc futures futures_place_order` payload.

`npm run arena:cockpit` writes:

- `public/arena-data.json` - sanitized public evidence data, including the latest local paper-order summary if present.
- `public/arena.html` - static Arena cockpit. Open it directly or serve `public/` with any static server.

`npm run broker:order -- --mode dry_run` appends a non-executing order record to `artifacts/order-dry-run.jsonl`. With Demo Trading credentials, `--mode paper` adds the Agent Hub `--paper-trading` flag and defaults to `BTCUSDT`, because Bitget Demo Trading supports crypto perps rather than RWA stock perps. Live mode is the RWA graduation path and requires `--mode live --confirm-live` plus credentials, a licensed passport, and the cap checks.

`npm run broker:balance -- --mode paper` checks the Demo USDT-Futures balance with the required `productType=USDT-FUTURES` query. Demo spot funds and demo futures funds are separate, so a funded spot demo wallet can still reject futures orders until USDT is moved or adjusted in the futures demo account.

`npm run demo` writes:

- `glassbox-demo.jsonl` - ignored local audit log
- `public/dashboard-data.json` - static dashboard data
- `public/dashboard.html` - judge-facing cockpit

`npm run probe:bitget` writes `data/bitget-probe-report.json`. Without `BITGET_WALLET_API_KEY` and `BITGET_WALLET_API_SECRET`, the report records the live blocker and keeps the proof status at `blocked_missing_credentials`.

## Credential ladder

1. Provision Bitget Wallet read credentials and rerun `npm run probe:bitget`.
2. Provision a Bitget Demo Trading API key with Trade permission and run the crypto paper-order path.
3. Only after paper trading passes, provision a separate live Trade key for one tiny supervised RWA fill.

Live orders remain blocked unless the passport is `LICENSED`, the order is below `LIVE_MAX_NOTIONAL_USDT`, margin is isolated, leverage is 1-2x, and the caller explicitly confirms live execution.
