import { DEFAULT_RISK_CONFIG, type RiskConfig } from "./riskGovernor";

export type MandateRuleId =
  | "overnight_loss_limit"
  | "max_position"
  | "evidence_conflict_flat";

export interface MandateRule {
  id: MandateRuleId;
  label: string;
  sourceText: string;
  effect: "risk_config" | "hard_veto";
  limitPct?: number;
}

export interface MandateState {
  overnightLossPct: number;
  positionPct: number;
  evidenceConflict: boolean;
  drawdownPct: number;
}

export interface MandateCheck {
  ok: boolean;
  appliedRules: MandateRule[];
  breachedRules: MandateRule[];
  vetoReasons: string[];
}

export interface CompiledMandate {
  source: string;
  riskConfig: RiskConfig;
  rules: MandateRule[];
  check: (state: MandateState) => MandateCheck;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function readPercent(match: RegExpMatchArray | null): number | null {
  if (!match) return null;
  const value = match.slice(1).find((part) => part !== undefined);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function breached(rule: MandateRule, state: MandateState): boolean {
  if (rule.id === "overnight_loss_limit") {
    return (
      typeof rule.limitPct === "number" &&
      state.overnightLossPct > rule.limitPct
    );
  }
  if (rule.id === "max_position") {
    return (
      typeof rule.limitPct === "number" && state.positionPct > rule.limitPct
    );
  }
  return state.evidenceConflict;
}

export function compileMandate(source: string): CompiledMandate {
  const text = source.trim();
  if (!text) throw new Error("mandate text is required");

  const lower = text.toLowerCase();
  const riskConfig: RiskConfig = { ...DEFAULT_RISK_CONFIG };
  const rules: MandateRule[] = [];
  const overnightLimit = readPercent(
    lower.match(/(?:never\s+)?lose\s*>\s*(\d+(?:\.\d+)?)%\s*overnight/),
  );
  const positionLimit = readPercent(
    lower.match(/max\s*(\d+(?:\.\d+)?)%\s*position/),
  );

  if (overnightLimit !== null) {
    riskConfig.drawdownHaltPct = Math.min(
      riskConfig.drawdownHaltPct,
      overnightLimit,
    );
    rules.push({
      id: "overnight_loss_limit",
      label: `overnight loss <= ${pct(overnightLimit)}`,
      sourceText: text,
      effect: "hard_veto",
      limitPct: overnightLimit,
    });
  }

  if (positionLimit !== null) {
    riskConfig.maxExposurePct = positionLimit;
    riskConfig.offHoursExposureCapPct = Math.min(
      riskConfig.offHoursExposureCapPct,
      positionLimit,
    );
    rules.push({
      id: "max_position",
      label: `position <= ${pct(positionLimit)}`,
      sourceText: text,
      effect: "risk_config",
      limitPct: positionLimit,
    });
  }

  if (lower.includes("evidence conflicts")) {
    rules.push({
      id: "evidence_conflict_flat",
      label: "stay flat when evidence conflicts",
      sourceText: text,
      effect: "hard_veto",
    });
  }

  if (rules.length === 0) {
    throw new Error("mandate did not contain a supported risk rule");
  }

  return {
    source: text,
    riskConfig,
    rules,
    check: (state) => {
      const breachedRules = rules.filter((rule) => breached(rule, state));
      return {
        ok: breachedRules.length === 0,
        appliedRules: rules,
        breachedRules,
        vetoReasons: breachedRules.map((rule) => rule.label),
      };
    },
  };
}
