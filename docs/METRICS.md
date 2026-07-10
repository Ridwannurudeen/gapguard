# GapGuard Metrics

Generated: 2026-06-23T06:31:13.507Z

GapGuard is an AI abstention and risk engine for tokenized US stocks: it decides whether an off-hours gap is liquidity noise to trade or news-driven repricing to respect, then proves every decision with a signed audit trail.

Boundary: Cryptographic integrity proof, not regulatory certification. Approval-gated live path; current stock evidence is backtest/paper.

| Metric | Return | Trades | Win | PF | Source |
| --- | ---: | ---: | ---: | ---: | --- |
| AAPLUSDT always-fade baseline | -0.397% | 15 | +40.0% | 0.95 | `artifacts/aaplusdt-backtest.json` |
| AAPLUSDT always-follow baseline | -2.955% | 15 | +26.7% | 0.63 | `artifacts/aaplusdt-news-aware-backtest.json` |
| AAPLUSDT Qwen gate-driven pilot | +1.418% | 13 | +38.5% | 1.35 | `artifacts/aaplusdt-news-aware-backtest.json` |
| AAPLUSDT label-aware baseline | +1.797% | 13 | +46.2% | 1.45 | `artifacts/aaplusdt-news-aware-backtest.json` |
| 20-symbol RWA always-fade baseline | -0.015% | 747 | +37.5% | 0.75 | `artifacts/rwa-multi-backtest.json` |
| positive pilot OOS over 16 trading days | +2.643% | 116 | +54.3% | 1.74 | `artifacts/rwa-alpha-certification.json` |

Gate audit: 12/15 (80%) on artifacts/aaplusdt-gate-audit.json; 2026-06-09 WWDC: correctly stood aside on a news-driven repricing gap.

Multi-symbol gate holdout: 341/790 candidates across 20 symbols in `artifacts/gate-holdout-report.json`. Full-bundle Qwen gate (evaluated): 39% accuracy (95% CI 33.724% to 44.282%) / 1.622% mean regret (95% CI 1.372% to 1.895%) vs always-fade 42.2% (95% CI 37.243% to 47.801%) / 1.775% (95% CI 1.496% to 2.043%). Mean-regret reduction CI vs always-fade: -0.029% to 0.324%; p=0.106 (not significant). But worst-case (p95) tail regret falls from 7.474% to 5.807% (reduction 95% CI 1.234% to 3.555%; p=0.001). The gate does not beat always-fade on average accuracy or mean regret; its significance-tested edge is cutting the tail-loss disaster days, reported as risk reduction, not a generalized-alpha claim.

Stock paper journal: `artifacts/stock-paper-journal.jsonl` and `artifacts/stock-paper-journal.csv` (58 rows, SIMULATED/PAPER_STOCK; not a live exchange stock fill).

Crypto Demo smoke: `artifacts/paper-btc-smoke.jsonl` (3 rows, Bitget Demo integration smoke (crypto BTCUSDT), not Track 3 stock evidence).

Live round-trip: `artifacts/live-trades.jsonl` — AAPLUSDT opened (order `1459271172842696705` @ 315.47) and closed (order `1459280427494780929` @ 315.16), size 0.05, balance -$0.034 (real live tokenized-stock fill, opened and closed on-exchange).

## Caveats

- The AAPL gate-driven result is n=15 and driven mainly by one correctly avoided WWDC loss.
- The 20-symbol always-fade basket is negative, which is why the product is an abstention/risk engine instead of a blind gap fader.
- The walk-forward result is a positive pilot OOS over 16 trading days, not proven profitable alpha.
- The single live round-trip fill proves the exchange path works end-to-end; it is one small trade, not a live-alpha claim.
