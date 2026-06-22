# GapGuard

An AI agent for trading the **off-hours gap on tokenized US stocks** — **Bitget AI Base Camp Hackathon S1, Track 3 (US Stock AI Trading)**. It fades the overnight dislocation on Bitget RWA stock perps (`AAPLUSDT`/`NVDAUSDT`) *only when the move looks like noise*, decided by the adversarial **Quorum** desk and made auditable by a verifiable **Agent Arena** licensing layer.

## The problem

Most autonomous trading-agent demos ask judges to trust a single LLM narrative. Agent Arena does the opposite: it makes agents earn a license before capital is unlocked. A candidate agent must show evidence, debate, risk controls, hash-chain verification, and a capped execution path. Weak or overconfident agents stay paper-only or get rejected.

GapGuard is now the flagship exhibit inside the Arena. Quorum, an adversarial desk, uses GapGuard's tokenized-stock gap-risk engine plus role-specialized debate to decide whether a tiny RWA perp fill has earned graduation from simulation.

## Architecture

| Module                                   | Role                                                                                                                                                          | Status                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `src/marketClock.ts`                     | Classifies the US session; `underlyingOpen` gates the edge; computes the next open.                                                                           | built + tested                     |
| `src/nyseCalendar2026.ts`                | Verified 2026 NYSE equity calendar.                                                                                                                           | built                              |
| `src/dislocation.ts`                     | Estimates token vs fair-value gap in volatility units.                                                                                                        | built + tested                     |
| `src/proxyReturn.ts`                     | Blends 24/7 proxy signals into an implied underlying return; weak confidence discounts the shift.                                                             | built + tested                     |
| `src/riskGovernor.ts`                    | Sizes by confidence/vol, caps off-hours exposure, realizes into reopen, and halts on drawdown.                                                                | built + tested                     |
| `src/glassbox.ts`                        | Hash-chained JSONL audit trail for tamper-evident decision records.                                                                                           | built + tested                     |
| `src/convergenceGate.ts` + `src/qwen.ts` | Qwen gate for fadeable gap vs justified repricing.                                                                                                            | built + tested                     |
| `src/quorum.ts`                          | Five-role adversarial desk: narrative, positioning, market intel, bear, and risk opinions become **evidence-weighted** consensus (well-cited views count more), veto status, and a position multiplier. | built + tested                     |
| `src/agentArena.ts`                      | Passport issuer. Grades candidates as `LICENSED`, `PAPER_ONLY`, or `REJECTED` from recorded evidence and controls.                                            | built + tested                     |
| `src/arena-chain.ts`                     | Arena-native JSONL hash chain for mandate rules, Quorum decisions, naive breaches, passports, and broker records, plus a **Merkle root signed with Ed25519** (`attestChain`/`verifyAttestation`) for regulator-grade, attributable, re-verifiable audit. | built + tested                     |
| `src/mandate.ts`                         | Deterministic natural-language risk mandate compiler for loss, position, and conflicting-evidence vetoes.                                                     | built + tested                     |
| `src/simBroker.ts`                       | Offline broker compatible with the live broker plan shape; fills against a deterministic price path for local Arena runs.                                     | built + tested                     |
| `src/liveStockBroker.ts`                 | Agent Hub broker wrapper. Defaults to dry-run, supports paper trading, and blocks live orders unless licensed, confirmed, isolated, low-leverage, and capped. | built + tested                     |
| `src/rwa-market.ts`                      | Public Bitget USDT-Futures contract/ticker recheck for RWA status, spread, volume, and minimum live order size.                                               | built + tested                     |
| `src/gapEngine.ts`                       | Shared deterministic gap-reversion engine (session collapse, gap trades with an optional stand-aside predicate, metrics) used by both backtests.              | built + tested                     |
| `src/backtest.ts`                        | Deterministic off-hours gap-reversion backtest on real public Bitget `AAPLUSDT` candles (no key); emits metrics + a per-trade log. No LLM in this path.       | built                              |
| `src/newsBacktest.ts`                    | News-aware variant: stands aside on verified scheduled catalysts (`data/aaplusdt-catalysts.json`) instead of fading them; compares always-fade vs catalyst-aware. | built                              |
| `src/arena-demo.ts`                      | Generates the Arena artifact with Quorum's passport, Naive's recorded mandate breach, the Quorum decision, sim broker fill, and Arena chain.                  | built + tested                     |
| `src/arena-cockpit.ts`                   | Builds sanitized public cockpit data from the Arena artifact, paper-trade evidence, Arena chain, and GapGuard proof summary.                                  | built + tested                     |
| `src/bitgetWalletApi.ts`                 | Bitget Wallet API signer/client using the documented HMAC flow.                                                                                               | built + tested                     |
| `src/bitgetProbe.ts`                     | Executable target-market probe for token info, K-lines, transaction info, and optional RWA quote routing.                                                     | built, blocked without API key     |
| `public/arena.html`                      | Judge-facing Arena cockpit with in-browser SubtleCrypto verification and a tamper simulation toggle for `public/arena-chain.jsonl`.                           | built                              |
| `public/dashboard.html`                  | Static judge cockpit for replay outcome, proxy confidence, risk actions, and hash-chain verification.                                                         | built                              |
| `playbook/`                              | Bitget Playbook package for the deterministic `AAPLUSDT` RWA perp managed-kline backtest path.                                                               | authored + local validation passed |

## Tooling

- **Agent Hub** (`bgc` CLI + `bitget-mcp-server`) - order path, Demo Trading bridge, and live-order guardrail.
- **Bitget Playbook** (`@bitget-ai/getagent-skill`) - deterministic `AAPLUSDT` RWA perp backtest package; no upload or publish has been run.
- **Qwen** (`qwen3.6-plus`) - optional convergence-gate reasoning.

## Develop

```bash
npm install
npm test
npm run typecheck
npm run backtest    # real AAPLUSDT off-hours gap-reversion backtest (no key) -> artifacts/aaplusdt-backtest.json
npm run backtest:news  # news-aware variant: stand aside on verified catalysts -> artifacts/aaplusdt-news-aware-backtest.json
npm run demo        # replay data/tslax-replay.json and write glassbox-demo.jsonl + public/dashboard-data.json
npm run verify-log  # verify the hash chain in glassbox-demo.jsonl
npm run arena:demo  # write artifacts/agent-arena-demo.json
npm run rwa:check    # write public/rwa-market.json from public Bitget futures data
npm run arena:cockpit
npm run broker:order -- --mode dry_run
npm run broker:balance -- --mode paper
npm run probe:bitget

# Optional Qwen convergence gate:
BITGET_QWEN_API_KEY=<your-key> npm run gate-demo
BITGET_QWEN_API_KEY=<your-key> npm run gate:audit  # live gate over every backtest gap -> artifacts/aaplusdt-gate-audit.json
```

`npm run arena:demo` writes:

- `artifacts/agent-arena-demo.json` - Quorum's licensed passport, the rejected naive bot, the five-agent Quorum decision, and the dry-run `bgc futures futures_place_order` payload.
- `public/arena-chain.jsonl` - Arena-native tamper-evident chain covering mandate rules, Quorum/Naive decisions, mandate breaches, passports, and the simulated broker record.

`npm run arena:cockpit` writes:

- `public/arena-data.json` - sanitized public evidence data, including the latest local paper-order summary if present.
- `public/arena.html` - Arena cockpit. Serve `public/` with any static server so the browser can fetch `arena-data.json` and `arena-chain.jsonl`.

`npm run rwa:check` writes `public/rwa-market.json` from Bitget's public contracts/tickers endpoints. It keeps `NVDAUSDT` as the judge-recognizable default when it is normal and RWA-labeled, reports the liquidity leader/backup, and computes the minimum size needed to clear the contract-reported `minTradeUSDT` floor under the 20 USDT cap.

`npm run broker:order -- --mode dry_run` appends a non-executing order record to `artifacts/order-dry-run.jsonl`. With Demo Trading credentials, `--mode paper` adds the Agent Hub `--paper-trading` flag and defaults to a tiny `BTCUSDT` order, because Bitget Demo Trading supports crypto perps rather than RWA stock perps. Live mode is the RWA graduation path and requires `--mode live --confirm-live` plus credentials, a licensed passport, and the cap checks.

`npm run broker:balance -- --mode paper` checks the Demo USDT-Futures balance with the required `productType=USDT-FUTURES` query. Demo spot funds and demo futures funds are separate, so a funded spot demo wallet can still reject futures orders until USDT is moved or adjusted in the futures demo account.

`npm run backtest` runs a deterministic off-hours gap-reversion on **real public Bitget `AAPLUSDT` candles** (committed fixture in `data/`; regenerate with `npm run backtest:fetch`). It fades an overnight gap at the US-session open (via `marketClock`) and exits at the session close, then writes `artifacts/aaplusdt-backtest.json` with metrics **and a per-trade log** (timestamp, asset, direction, price, qty, balance change). No API key, no LLM in this path. The always-fade baseline is honestly ~flat — it motivates the convergence gate + risk governor rather than claiming edge.

`npm run demo` writes:

- `glassbox-demo.jsonl` - ignored local audit log
- `public/dashboard-data.json` - static dashboard data
- `public/dashboard.html` - judge-facing cockpit

`npm run probe:bitget` writes `data/bitget-probe-report.json`. Without `BITGET_WALLET_API_KEY` and `BITGET_WALLET_API_SECRET`, the report records the live blocker and keeps the proof status at `blocked_missing_credentials`.

## Credential ladder

1. Provision Bitget Wallet read credentials and rerun `npm run probe:bitget`.
2. Provision a Bitget Demo Trading API key with Trade permission and run the crypto paper-order path.
3. Run `npm run rwa:check` immediately before selecting the final live RWA symbol and size.
4. Only after paper trading passes, provision a separate live Trade key for one tiny supervised RWA fill.

Live orders remain blocked unless the passport is `LICENSED`, the order is below `LIVE_MAX_NOTIONAL_USDT`, margin is isolated, leverage is 1-2x, and the caller explicitly confirms live execution.
