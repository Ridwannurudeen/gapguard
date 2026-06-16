import { describe, expect, it } from "vitest";
import { loadReplayDataset, runReplayDataset } from "../src/replayProof";

describe("replayProof", () => {
  it("runs the committed TSLAx replay dataset with a valid hash chain", () => {
    const dataset = loadReplayDataset("data/tslax-replay.json");
    const run = runReplayDataset(dataset);

    expect(run.records).toHaveLength(dataset.ticks.length);
    expect(run.verification.ok).toBe(true);
    expect(
      run.records.some((r) => r.market.proxyConfidence !== undefined),
    ).toBe(true);
    expect(run.records.at(-1)?.risk.action).toBe("flatten");
  });
});
