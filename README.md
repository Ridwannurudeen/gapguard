# GapGuard

An AI agent for evaluating the **off-hours gap on tokenized US stocks** — **Bitget AI Base Camp Hackathon S1, Track 3 (US Stock AI Trading)**. The current public build replays a deterministic, evidence-weighted **Quorum** scenario for Bitget RWA stock perps (`AAPLUSDT`/`NVDAUSDT`), with live Qwen used only where the Qwen gate/audit path is explicitly named, and makes the result auditable through a verifiable **Agent Arena** licensing layer.

## The problem

Most autonomous trading-agent demos ask judges to trust a single LLM narrative. Agent Arena does the opposite: it makes agents earn a license before capital can graduate beyond simulation. A candidate agent must show evidence, debate, risk controls, hash-chain verification, and a capped execution path. Weak or overconfident agents stay paper-only or get rejected.

GapGuard is now the flagship exhibit inside the Arena. Quorum, an adversarial desk in the current artifact, uses GapGuard's tokenized-stock gap-risk engine plus role-specialized, deterministic debate to decide whether a simulated RWA dry-run has earned a gated graduation path. The only real exchange fill currently claimed is the separate Bitget Demo crypto paper fill.

## Architecture

| Module                                   | Role                                                                                                                                                          | Status                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `src/marketClock.ts`                     | Classifies the US session; `underlyingOpen` gates the edge; computes the next open.                                                                           | built + tested                     |
| `src/nyseCalendar2026.ts`                | Verified 2026 NYSE equity calendar.                                                                                                                           | built                              |
| `src/dislocation.ts`                     | Estimates token vs fair-value gap in volatility units.                                                                                                        | built + tested                     |
| `src/proxyReturn.ts`                     | Blends 24/7 proxy signals into an implied underlying return; weak confidence discounts the shift.                                                             | built + tested                     |
| `src/riskGovernor.ts`                    | Sizes by confidence/vol, caps off-hours exposure, realizes into reopen, and halts on drawdown.                                                                | built + tested                     |
| `src/glassbox.ts`                        | Hash-chained JSONL audit trail for tamper-evident decision records.                                                                                           | built + tested                     |
| `src/convergenceGate.ts` + `src/qwen.ts` | Optional live Qwen gate for fadeable gap vs justified repricing; the committed gate-driven replay uses the cached audit verdicts.                             | built + tested                     |
| `src/quorum.ts`                          | Five-role deterministic adversarial desk: narrative, positioning, market intel, bear, and risk opinions become **evidence-weighted** consensus (well-cited views count more), veto status, and a position multiplier. | built + tested                     |
| `src/agentArena.ts`                      | Passport issuer. Grades candidates as `LICENSED`, `PAPER_ONLY`, or `REJECTED` from recorded evidence and controls.                                            | built + tested                     |
| `src/arena-chain.ts`                     | Arena-native JSONL hash chain for mandate rules, Quorum decisions, naive breaches, passports, and broker records, plus a **Merkle root signed with Ed25519** (`attestChain`/`verifyAttestation`) for regulator-grade, attributable, re-verifiable audit. | built + tested                     |
| `src/mandate.ts`                         | Deterministic natural-language risk mandate compiler for loss, position, and conflicting-evidence vetoes.                                                     | built + tested                     |
| `src/simBroker.ts`                       | Offline broker compatible with the live broker plan shape; fills against a deterministic price path for local Arena runs.                                     | built + tested                     |
| `src/liveStockBroker.ts`                 | Agent Hub broker wrapper. Defaults to dry-run, supports paper trading, and blocks live orders unless licensed, confirmed, isolated, low-leverage, and capped. | built + tested                     |
| `src/rwa-market.ts`                      | Public Bitget USDT-Futures contract/ticker recheck for RWA status, spread, volume, and minimum live order size.                                               | built + tested                     |
| `src/gapEngine.ts`                       | Shared deterministic gap-reversion engine (session collapse, gap trades with an optional stand-aside predicate, metrics) used by both backtests.              | built + tested                     |
| `src/slippage.ts`                        | Resolves backtest slippage from `BT_SLIPPAGE_BPS` or spread-derived half-spread stress in `public/rwa-market.json`.                                          | built + tested                     |
| `src/backtest.ts`                        | Deterministic off-hours gap-reversion backtest on real public Bitget `AAPLUSDT` candles (no key); emits metrics + a per-trade log. No LLM in this path.       | built                              |
| `src/newsBacktest.ts`                    | Cache-aware news variant: reports the label-aware catalyst baseline and consumes `data/aaplusdt-gate-verdicts.json` for the true gate-driven variant.                      | built + tested                     |
| `src/multiBacktest.ts`                   | 20-symbol public Bitget RWA basket backtest for broader, no-key evidence beyond the small AAPL window.                                                        | built + tested                     |
| `src/alphaCertification.ts`              | Walk-forward RWA alpha certification: a locked selective gap-follow rule, formation/OOS split, baselines, and passport evidence.                              | built + tested                     |
| `src/arena-demo.ts`                      | Generates the Arena artifact with Quorum's passport, Naive's recorded mandate breach, the Quorum decision, sim broker fill, and Arena chain.                  | built + tested                     |
| `src/arena-cockpit.ts`                   | Builds sanitized public cockpit data from the Arena artifact, crypto Demo paper-trade evidence, Arena chain, and GapGuard proof summary.                      | built + tested                     |
| `src/bitgetWalletApi.ts`                 | Bitget Wallet API signer/client using the documented HMAC flow.                                                                                               | built + tested                     |
| `src/bitgetProbe.ts`                     | Executable target-market probe for token info, K-lines, transaction info, and optional RWA quote routing.                                                     | built, blocked without API key     |
| `public/arena.html`                      | Judge-facing Arena cockpit with in-browser SubtleCrypto verification and a tamper simulation toggle for `public/arena-chain.jsonl`.                           | built                              |
| `public/dashboard.html`                  | Static judge cockpit for replay outcome, proxy confidence, risk actions, and hash-chain verification.                                                         | built                              |
| `playbook/`                              | Bitget Playbook package for the deterministic `AAPLUSDT` RWA perp managed-kline backtest path.                                                               | authored + local validation passed |

## Tooling

- **Agent Hub** (`bgc` CLI + `bitget-mcp-server`) - dry-run order path, Demo Trading bridge, and approval-gated live-order guardrail.
- **Bitget Playbook** (`@bitget-ai/getagent-skill`) - deterministic `AAPLUSDT` RWA perp backtest package; no upload or publish has been run.
- **Qwen** (`qwen3.6-plus`) - optional live convergence-gate reasoning; current cached gate replay is negative.

## Develop

```bash
npm install
npm test
npm run typecheck
npm run backtest    # real AAPLUSDT off-hours gap-reversion backtest (no key) -> artifacts/aaplusdt-backtest.json
npm run backtest:news  # label-aware baseline + cached Qwen gate-driven variant
npm run backtest:multi # 20-symbol RWA basket -> artifacts/rwa-multi-backtest.json
npm run alpha:certify  # walk-forward RWA alpha certification -> artifacts/rwa-alpha-certification.json
npm run demo        # replay data/tslax-replay.json and write glassbox-demo.jsonl + public/dashboard-data.json
npm run verify-log  # verify the hash chain in glassbox-demo.jsonl
npm run arena:demo  # write artifacts/agent-arena-demo.json
npm run rwa:check    # write public/rwa-market.json from public Bitget futures data
npm run arena:keygen  # one-time: create ignored .arena-signing-key.pem + public/arena-pubkey.pem
npm run arena:cockpit
npm run broker:order -- --mode dry_run
npm run broker:balance -- --mode paper
npm run probe:bitget

# Optional Qwen convergence gate:
BITGET_QWEN_API_KEY=<your-key> npm run gate-demo
BITGET_QWEN_API_KEY=<your-key> npm run gate:audit  # blinded live gate over every backtest gap -> data/aaplusdt-gate-verdicts.json
```

`npm run arena:demo` writes:

- `artifacts/agent-arena-demo.json` - Quorum's paper-only passport under the positive walk-forward RWA certification but only 2 paper fills, the rejected naive bot, the deterministic five-role Quorum decision, and the dry-run `bgc futures futures_place_order` payload.
- `public/arena-chain.jsonl` - Arena-native tamper-evident chain covering mandate rules, Quorum/Naive decisions, mandate breaches, passports, and the simulated broker record.

`npm run arena:cockpit` writes:

- `public/arena-data.json` - sanitized public evidence data, including the latest local crypto Demo paper-order summary if present.
- `public/arena-attestation.json` - Ed25519 signature over the recomputed Merkle root, verified against `public/arena-pubkey.pem`.
- `public/arena.html` - Arena cockpit. Serve `public/` with any static server so the browser can fetch `arena-data.json` and `arena-chain.jsonl`.

`npm run rwa:check` writes `public/rwa-market.json` from Bitget's public contracts/tickers endpoints. It keeps `NVDAUSDT` as the judge-recognizable default when it is normal and RWA-labeled, reports the liquidity leader/backup, and computes the minimum size needed to clear the contract-reported `minTradeUSDT` floor under the 20 USDT cap.

`npm run broker:order -- --mode dry_run` appends a non-executing order record to `artifacts/order-dry-run.jsonl`. With Demo Trading credentials, `--mode paper` adds the Agent Hub `--paper-trading` flag and defaults to a tiny `BTCUSDT` order, because Bitget Demo Trading supports crypto perps rather than RWA stock perps. Live mode is implemented but remains gated; it requires `--mode live --confirm-live` plus credentials, a truly `LICENSED` passport, positive alpha evidence, at least 3 paper fills, and the cap checks.

`npm run broker:balance -- --mode paper` checks the Demo USDT-Futures balance with the required `productType=USDT-FUTURES` query. Demo spot funds and demo futures funds are separate, so a funded spot demo wallet can still reject futures orders until USDT is moved or adjusted in the futures demo account.

`npm run backtest` runs a deterministic off-hours gap-reversion on **real public Bitget `AAPLUSDT` candles** (committed fixture in `data/`; regenerate with `npm run backtest:fetch`). It fades an overnight gap at the US-session open (via `marketClock`) and exits at the session close, then writes `artifacts/aaplusdt-backtest.json` with metrics **and a per-trade log** (timestamp, asset, direction, price, qty, balance change). No API key, no LLM in this path. Execution assumptions include `BT_COST` plus `BT_SLIPPAGE_BPS` when set; otherwise the runner uses a spread-derived half-spread stress from `public/rwa-market.json`. The always-fade baseline is honestly ~flat — it motivates the convergence gate + risk governor rather than claiming edge.

`npm run backtest:news` separates the label baseline from the AI-backed path. The committed `data/aaplusdt-gate-verdicts.json` cache was generated by `BITGET_QWEN_API_KEY=<your-key> npm run gate:audit`: Qwen scored 14/15 blinded verdicts, but missed the key WWDC stand-aside, so the true gate-driven backtest is negative (-2.165%). That is the honest result, not a marketing edge claim.

`npm run backtest:fetch:rwa` writes a broader public Bitget RWA fixture basket under `data/rwa-sample/`; `npm run backtest:multi` replays it. The current 20-symbol, 790-trade always-fade result is negative, which is useful evidence: blindly fading every RWA off-hours gap is not the product. The product is the gate, risk governor, and verifiable licensing layer.

`npm run alpha:certify` runs the locked walk-forward RWA certification on the same 20-symbol fixture basket. It does not select full-sample winners. The first 60% of unique gap dates form the prior history; later dates are out-of-sample. The current artifact (`artifacts/rwa-alpha-certification.json`) clears positive alpha on the selected rule: 119 OOS trades, +3.785% portfolio return, Sharpe 6.511, PF 2.20, versus -5.471% for OOS always-fade after costs. This is the passport alpha evidence; it is still not a live-fill claim.

`npm run demo` writes:

- `glassbox-demo.jsonl` - ignored local audit log
- `public/dashboard-data.json` - static dashboard data
- `public/dashboard.html` - judge-facing cockpit

`npm run probe:bitget` writes `data/bitget-probe-report.json`. Without `BITGET_WALLET_API_KEY` and `BITGET_WALLET_API_SECRET`, the report records the live blocker and keeps the proof status at `blocked_missing_credentials`.

## Credential ladder

1. Provision Bitget Wallet read credentials and rerun `npm run probe:bitget`.
2. Provision a Bitget Demo Trading API key with Trade permission and run the crypto paper-order path.
3. Run `npm run rwa:check` immediately before selecting the final live RWA symbol and size.
4. Only after paper trading passes, provision a separate live Trade key for one tiny supervised RWA stock-perp order; this is the future live path, not a fill claimed by the current artifacts.

Live orders remain blocked unless the passport is `LICENSED`, the alpha evidence is positive, the order is below `LIVE_MAX_NOTIONAL_USDT`, margin is isolated, leverage is 1-2x, and the caller explicitly confirms live execution. In the current generated artifacts Quorum is still `PAPER_ONLY`, not live-licensed, because this shell has only 2 real Demo paper fills recorded; one more tiny BTCUSDT Demo paper fill is needed before the Arena can issue a `LICENSED` passport.
