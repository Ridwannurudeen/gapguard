"""Entry point for the GapGuard AAPLUSDT RWA perp Playbook."""

import math
from typing import Any

from getagent import backtest, data, runtime


def _sanitize(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def run() -> None:
    cfg = runtime.manifest.get("strategy_config", {}) or {}
    symbols = cfg.get("trading_symbols") or ["AAPLUSDT"]
    symbol = symbols[0]
    interval = cfg.get("interval", "1h")
    exchange = cfg.get("exchange", "bitget")

    bars = data.crypto.futures.kline(
        symbol=symbol,
        interval=interval,
        exchange=exchange,
        limit=200,
        provider="bitget_data",
    )
    replay_frame = backtest.prepare_frame(bars, datetime_index="date")

    if replay_frame.empty:
        runtime.emit_signal(
            action="watch",
            symbol=symbol,
            confidence=0.0,
            metrics={"rows": 0},
            meta={
                "reason": "no managed Bitget kline rows returned",
                "proof_scope": "bitget_aaplusdt_rwa_perp_backtest",
                "backtest_support": "none",
            },
        )
        return

    instrument_key = f"{symbol}.BITGET"
    result = backtest.run(
        ohlcv_data={instrument_key: replay_frame},
        spec=runtime.backtest_spec,
    )

    chart_path = backtest.generate_chart(result)
    metrics = {
        key: _sanitize(val)
        for key, val in {
            "total_return_pct": result.total_return_pct,
            "sharpe_ratio": result.sharpe_ratio,
            "max_drawdown_pct": result.max_drawdown_pct,
            "win_rate": result.win_rate,
            "total_trades": result.total_trades,
            "profit_factor": result.profit_factor,
            "rows": len(replay_frame),
        }.items()
    }

    action = "long" if (result.total_return_pct or 0) > 0 else "watch"
    runtime.emit_signal(
        action=action,
        symbol=symbol,
        confidence=_sanitize(result.win_rate) or 0.0,
        metrics=metrics,
        meta={
            "chart_path": chart_path,
            "proof_scope": "bitget_aaplusdt_rwa_perp_backtest",
            "data_provider": "data.crypto.futures.kline bitget_data",
            "exchange": exchange,
            "interval": interval,
            "backtest_support": "full",
            "limitation": "managed backtest evidence only; no live stock fill claimed",
        },
    )


if __name__ == "__main__":
    run()
