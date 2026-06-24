import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProbeReport } from "../src/bitgetProbe";

describe("bitget probe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not classify non-official base URL responses as live Bitget proof", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: 0, data: { list: [] } }), {
          status: 200,
          statusText: "OK",
        }),
      ),
    );

    const report = await buildProbeReport({
      BITGET_WALLET_API_BASE_URL: "http://127.0.0.1:9999",
    });

    expect(report.proofStatus).toBe("blocked_target_or_api");
    expect(report.conclusion).toContain("not the official Bitget Wallet");
  });

  it("does not send signed wallet requests to non-official base URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const report = await buildProbeReport({
      BITGET_WALLET_API_BASE_URL: "http://127.0.0.1:9999",
      BITGET_WALLET_API_KEY: "key",
      BITGET_WALLET_API_SECRET: "secret",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(report.proofStatus).toBe("blocked_target_or_api");
    expect(report.endpoints[0].message).toContain("non-official base URL");
  });
});
