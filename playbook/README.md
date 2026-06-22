# GapGuard AAPLUSDT RWA Perp Reversion

Deterministic GetAgent Playbook for the Agent Arena backtest evidence path. It
uses Bitget `AAPLUSDT` RWA perp candles through `data.crypto.futures.kline`
instead of the old TSLA ordinary-equity/FMP baseline.

## Scope

- **Instrument:** `AAPLUSDT`, exchange-native Bitget USDT-M contract symbol.
- **Data path:** managed crypto futures kline, `exchange="bitget"`,
  `provider="bitget_data"`, interval `1h`.
- **Execution mode:** `signal_only`.
- **Reasoning:** no LLM in the backtested path.
- **Claim boundary:** managed backtest evidence only; no live stock fill is
  claimed.

## How It Works

- **Signal:** current candle open versus the previous candle close.
- **Entry:** short a sharp upward dislocation, long a sharp downward
  dislocation.
- **Exit:** close after a fixed holding window.
- **Sizing:** fixed contract size against a configured USDT margin budget.

## Probe Result

The local environment does not include the managed GetAgent runtime, so the
managed run itself is not uploaded or published here. The public Bitget contract
and kline probes were checked before repointing:

- `AAPLUSDT` contract returned `isRwa=YES`, `symbolStatus=normal`.
- Public Bitget `1H` candle probe returned non-empty rows.
- Recorded probe artifact: `aaplusdt-kline-probe.json`.

If the managed kline path returns empty rows in a hosted run, the Playbook emits
`action="watch"` with `backtest_support="none"` and the submission should rely
on Arena simulation plus BTCUSDT paper evidence instead.

## Parameters

- **Dislocation threshold:** larger values trade fewer moves.
- **Holding bars:** longer holds give reversion more time but more event risk.
- **Trade size:** fixed `AAPLUSDT` contract size.
- **Margin budget:** denominator for return metrics.

## Risks

RWA perps can trend after real equity news, spreads can widen, and liquidity can
be thinner than major crypto perps. This package is a backtest artifact for the
hackathon evidence stack, not a live trading recommendation.

## 中文摘要

策略：使用 Bitget AAPLUSDT RWA 永续合约的一小时 K 线，测试价格在剧烈偏离前一根
K 线收盘价后是否出现短线均值回归。

开仓：当前 K 线开盘价明显高于前收盘价时做空，明显低于前收盘价时做多，其余情况保持
空仓。

平仓：持仓达到固定 K 线数量后市价平仓，不等待主观判断或 LLM 解释。

风险：RWA 永续可能因真实股票新闻继续单边运行，流动性和点差也可能弱于主流加密合约。
