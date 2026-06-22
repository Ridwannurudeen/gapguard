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
  notionalUSDT: number;
  realizedPnlUSDT: number;
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
  const plan = buildFuturesOrderPlan(intent, cfg);
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
    notionalUSDT: plan.notionalUSDT,
    realizedPnlUSDT,
  };

  return {
    status: cfg.mode === "dry_run" ? "dry_run" : "submitted",
    plan,
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
