import { describe, expect, it } from "vitest";
import { compileMandate } from "../src/mandate";

const mandateText =
  "never lose >1.5% overnight; max 20% position; stay flat when evidence conflicts";

describe("risk mandate compiler", () => {
  it("compiles supported natural-language rules into risk config", () => {
    const mandate = compileMandate(mandateText);

    expect(mandate.riskConfig.drawdownHaltPct).toBe(0.015);
    expect(mandate.riskConfig.maxExposurePct).toBe(0.2);
    expect(mandate.riskConfig.offHoursExposureCapPct).toBe(0.2);
    expect(mandate.rules.map((rule) => rule.id)).toEqual([
      "overnight_loss_limit",
      "max_position",
      "evidence_conflict_flat",
    ]);
  });

  it("records hard-veto breaches from observed behavior", () => {
    const check = compileMandate(mandateText).check({
      overnightLossPct: 0.024,
      positionPct: 0.5,
      evidenceConflict: true,
      drawdownPct: 0.14,
    });

    expect(check.ok).toBe(false);
    expect(check.vetoReasons).toEqual([
      "overnight loss <= 1.5%",
      "position <= 20.0%",
      "stay flat when evidence conflicts",
    ]);
  });
});
