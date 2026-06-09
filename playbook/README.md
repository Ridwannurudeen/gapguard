# GapGuard Overnight Gap Reversion

A mean-reversion Playbook on a single US equity. It fades outsized overnight gaps — when the
stock opens far from the prior close — and expects price to partially revert as regular trading
resumes and liquidity returns.

## How it works

- **Signal:** the overnight gap, measured as the session open versus the prior session close.
- **Entry:** short a sharp gap up, long a sharp gap down, only when the gap stands out from
  ordinary movement.
- **Exit:** close after a short fixed holding window; the window is also the risk control.
- **Sizing:** a fixed share size against a margin budget used as the return denominator.

## Parameters

- **Gap sensitivity** — higher trades less often, only on the most extreme opens.
- **Holding window** — longer gives reversion more room but more exposure to fresh news.
- **Margin budget** — the capital sized against; the denominator for return percentage.

## Reading the backtest

Strategy return is net PnL over the margin budget; account return is over the venue starting
balance. Read max drawdown and win rate together with total trades — a high return on very few
trades is not yet evidence.

## Risks

A gap can be justified repricing (earnings, major news); then the fade loses. The strategy
underperforms in strong trends and around scheduled catalysts, and can string together losses
when gaps persist. Past backtest performance does not guarantee live results.

## 中文摘要

本策略在美股标的上进行隔夜跳空均值回归：开盘相对前收盘大幅跳空时反向开仓（跳空高开则做空、跳空低开则做多），
在固定持有窗口后平仓。固定持有窗口同时作为风险控制手段。主要风险是跳空源于真实的基本面重定价（财报、重大新闻），
此时价格持续单边运行、回归失败而导致亏损。
