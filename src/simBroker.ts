import { createHash } from "node:crypto";
import {
  buildFuturesOrderPlan,
  type BrokerConfig,
  type BrokerMode,
  type BrokerResult,
  type FuturesOrderIntent,
  type FuturesSide,
} from "./liveStockBroker";

export interface SimBrokerOptions {
  pricePath: number[];
  startingBalanceUSDT?: number;
  ts?: string;
  feeRate?: number;
}

export interface SimBrokerFill {
  ts: string;
  symbol: string;
  mode: BrokerMode;
  side: FuturesSide;
  size: number;
  referencePrice: number;
  fillPrice: number;
  exitPrice: number;
  orderId: string;
  balanceBefore: number;
  balanceAfter: number;
  balanceDelta: number;
  executedQty: number;
  avgFillPrice: number;
  feeUSDT: number;
  notionalUSDT: number;
  realizedPnlUSDT: number;
}

export interface SimBrokerState {
  openOrders: { orderId: string; symbol: string }[];
  positionSize: number;
  entryPrice: number;
  markPrice: number;
  balanceUSDT: number;
}

export interface SimKillSwitchResult {
  cancelledOrderIds: string[];
  flattenOrder: {
    symbol: string;
    side: "sell" | "buy";
    executedQty: number;
    avgFillPrice: number;
    realizedPnlUSDT: number;
  } | null;
  finalPositionSize: 0;
  finalBalanceUSDT: number;
}

export interface SimBrokerResult extends BrokerResult {
  fill: SimBrokerFill;
  stdout: string;
  stderr: string;
}

function assertPricePath(pricePath: number[]): void {
  if (pricePath.length === 0) throw new Error("pricePath is required");
  for (const price of pricePath) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("pricePath must contain positive finite prices");
    }
  }
}

function orderIdFor(intent: FuturesOrderIntent, pricePath: number[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ intent, pricePath }))
    .digest("hex");
  return `SIM-${hash.slice(0, 16)}`;
}

function sideSign(side: FuturesSide): number {
  return side.endsWith("long") ? 1 : -1;
}

export async function placeSimulatedFuturesOrder(
  intent: FuturesOrderIntent,
  cfg: BrokerConfig,
  options: SimBrokerOptions,
): Promise<SimBrokerResult> {
  assertPricePath(options.pricePath);
  const livePlan = buildFuturesOrderPlan(intent, cfg);
  const plan = {
    ...livePlan,
    command: "simBroker",
    args: ["simulated-futures-order"],
  };
  const fillPrice = options.pricePath[0];
  const exitPrice = options.pricePath[options.pricePath.length - 1];
  const realizedPnlUSDT =
    (exitPrice - fillPrice) * intent.size * sideSign(intent.side);
  const fee = fillPrice * intent.size * (options.feeRate ?? 0);
  const balanceBefore = options.startingBalanceUSDT ?? 10_000;
  const balanceDelta = realizedPnlUSDT - fee;
  const balanceAfter = balanceBefore + balanceDelta;
  const orderId = orderIdFor(intent, options.pricePath);
  const fill: SimBrokerFill = {
    ts: options.ts ?? new Date().toISOString(),
    symbol: intent.symbol,
    mode: cfg.mode,
    side: intent.side,
    size: intent.size,
    referencePrice: intent.referencePrice,
    fillPrice,
    exitPrice,
    orderId,
    balanceBefore,
    balanceAfter,
    balanceDelta,
    executedQty: intent.size,
    avgFillPrice: fillPrice,
    feeUSDT: fee,
    notionalUSDT: plan.notionalUSDT,
    realizedPnlUSDT,
  };

  return {
    status: cfg.mode === "dry_run" ? "dry_run" : "submitted",
    plan,
    receipt: {
      clientOid: plan.order.clientOid,
      orderId,
      status: cfg.mode === "dry_run" ? "dry_run" : "filled",
      executedQty: intent.size,
      avgFillPrice: fillPrice,
      feeUSDT: fee,
      realizedPnlUSDT,
      balanceDelta,
      transitions: [
        {
          ts: fill.ts,
          status: cfg.mode === "dry_run" ? "submitted" : "filled",
          orderId,
          rawStatus: cfg.mode === "dry_run" ? "dry_run" : "filled",
          avgFillPrice: fillPrice,
          executedQty: intent.size,
        },
      ],
    },
    fill,
    stdout: JSON.stringify({
      code: "SIMULATED",
      data: {
        orderId,
        fillPrice,
        exitPrice,
        balanceBefore,
        balanceAfter,
        balanceDelta,
      },
    }),
    stderr: "",
  };
}

export function simulateKillSwitch(state: SimBrokerState): SimKillSwitchResult {
  const cancelledOrderIds = state.openOrders.map((order) => order.orderId);
  if (state.positionSize === 0) {
    return {
      cancelledOrderIds,
      flattenOrder: null,
      finalPositionSize: 0,
      finalBalanceUSDT: state.balanceUSDT,
    };
  }

  const side = state.positionSize > 0 ? "sell" : "buy";
  const executedQty = Math.abs(state.positionSize);
  const realizedPnlUSDT =
    (state.markPrice - state.entryPrice) * state.positionSize;
  return {
    cancelledOrderIds,
    flattenOrder: {
      symbol: state.openOrders[0]?.symbol ?? "UNKNOWN",
      side,
      executedQty,
      avgFillPrice: state.markPrice,
      realizedPnlUSDT,
    },
    finalPositionSize: 0,
    finalBalanceUSDT: +(state.balanceUSDT + realizedPnlUSDT).toFixed(8),
  };
}
