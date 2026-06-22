from decimal import Decimal
from typing import Optional

from nautilus_trader.config import StrategyConfig
from nautilus_trader.model.data import Bar, BarType
from nautilus_trader.model.enums import OrderSide, TimeInForce
from nautilus_trader.model.identifiers import InstrumentId
from nautilus_trader.model.instruments import Instrument
from nautilus_trader.model.objects import Quantity
from nautilus_trader.trading.strategy import Strategy


class GapReversionConfig(StrategyConfig):
    instrument_id: Optional[InstrumentId] = None
    bar_type: Optional[BarType] = None
    instrument_ids: tuple[InstrumentId, ...] = ()
    bar_types: tuple[BarType, ...] = ()
    trade_size: str = "10"
    gap_threshold_pct: float = 0.02
    hold_bars: int = 1


class GapReversionStrategy(Strategy):
    """Fade an outsized RWA perp candle move and exit after a fixed hold."""

    def __init__(self, config: GapReversionConfig) -> None:
        super().__init__(config)
        self.cfg = config
        self._prev_close: Optional[float] = None
        self._position: str = "NONE"
        self._bars_held: int = 0
        self._instrument: Optional[Instrument] = None

    def on_start(self) -> None:
        bar_type = self.cfg.bar_type or (
            self.cfg.bar_types[0] if self.cfg.bar_types else None
        )
        instrument_id = self.cfg.instrument_id or (
            self.cfg.instrument_ids[0] if self.cfg.instrument_ids else None
        )
        if bar_type is None or instrument_id is None:
            raise RuntimeError("bar_type and instrument_id must be set")
        self._instrument = self.cache.instrument(instrument_id)
        self.subscribe_bars(bar_type)

    def on_bar(self, bar: Bar) -> None:
        open_px = float(bar.open)
        close_px = float(bar.close)
        prev_close = self._prev_close
        self._prev_close = close_px

        instrument = self._instrument
        if instrument is None:
            return

        # Hold an open position for the fixed window, then realize the reversion.
        if self._position != "NONE":
            self._bars_held += 1
            if self._bars_held >= max(1, self.cfg.hold_bars):
                exit_side = (
                    OrderSide.SELL if self._position == "LONG" else OrderSide.BUY
                )
                self._close_open(instrument.id, exit_side)
                self._position = "NONE"
                self._bars_held = 0
            return

        if prev_close is None or prev_close <= 0.0:
            return

        gap = (open_px - prev_close) / prev_close
        qty = Quantity(Decimal(self.cfg.trade_size), instrument.size_precision)

        if gap >= self.cfg.gap_threshold_pct:
            # Sharp candle up -> fade short, expecting a pull back toward the prior close.
            self._submit(instrument.id, OrderSide.SELL, qty)
            self._position = "SHORT"
            self._bars_held = 0
        elif gap <= -self.cfg.gap_threshold_pct:
            # Sharp candle down -> fade long.
            self._submit(instrument.id, OrderSide.BUY, qty)
            self._position = "LONG"
            self._bars_held = 0

    def _submit(
        self, instrument_id: InstrumentId, side: OrderSide, quantity: Quantity
    ) -> None:
        order = self.order_factory.market(
            instrument_id=instrument_id,
            order_side=side,
            quantity=quantity,
            time_in_force=TimeInForce.GTC,
        )
        self.submit_order(order)

    def _close_open(self, instrument_id: InstrumentId, side: OrderSide) -> None:
        for position in self.cache.positions_open(instrument_id=instrument_id):
            self._submit(instrument_id, side, position.quantity)

    def on_stop(self) -> None:
        if self._instrument is not None:
            self.cancel_all_orders(self._instrument.id)
            self.close_all_positions(self._instrument.id)
