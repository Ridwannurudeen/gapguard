# Playbook run — real TSLA backtest (GetAgent Cloud)

The `playbook/` package (overnight-gap reversion on US-equity daily bars) was authored, uploaded,
and executed in the Bitget GetAgent cloud sandbox. These are the verifiable run records.

## Identifiers

| Field | Value |
| --- | --- |
| Strategy ID | `778f2bd9-149a-42af-87bc-35ee231c1f17` |
| Run ID | `pbrun-6bb44c13d8b7` |
| Instrument | `TSLA.NASDAQ` (daily bars, `TSLA.NASDAQ-1-DAY-LAST-EXTERNAL`) |
| Window | 2024-01-01 → 2025-12-31 (252 real daily bars) |
| Account | MARGIN / NETTING, $100k starting balance, $1k margin budget per position |

## Metrics (author-side `backtest.run`)

| Metric | Value |
| --- | --- |
| Sharpe | 1.96 |
| Win rate | 75% |
| Trades | 40 |
| Profit factor | 3.48 |
| Account return | ~0.16% / 2yr |

The account return is small because daily bars miss the intraday open snap-back that is the actual
thesis — the reversion *core* is faithful, but daily resolution understates the gap edge.

## Known platform ceiling

The **managed** backtest path is crypto-only: the platform's bar fetch routes by `manifest.market_type`
(`spot`/`contract`, both crypto), so a US-equity `instrument_id=TSLA.NASDAQ` run returns HTTP 400 and
carries `status: failed`. There is no equity `market_type`/`kind`/data-source field. The real metrics
above come from the author-side `backtest.run` in `src/main.py`, which fetches equity data via
`data.equity.price.historical(..., provider="fmp")`. See `docs/ROADMAP.md` for the full analysis.

## To capture

- [ ] Screenshot of the GetAgent run detail page (strategy `778f2bd9…`) → add `getagent-run.png` here.
- [ ] Raw `metrics_output` JSON from the run → add `metrics_output.json` here.
