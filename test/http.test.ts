import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTextWithRetry } from "../src/http";

describe("fetchTextWithRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries retryable status codes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 429, statusText: "Too Many Requests" }),
      )
      .mockResolvedValueOnce(
        new Response("ok", { status: 200, statusText: "OK" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchTextWithRetry("https://example.test", undefined, {
        retries: 1,
        retryDelayMs: 1,
      }),
    ).resolves.toMatchObject({ ok: true, text: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable status codes", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("bad", { status: 400, statusText: "Bad Request" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchTextWithRetry("https://example.test", undefined, {
        retries: 2,
        retryDelayMs: 1,
      }),
    ).resolves.toMatchObject({ ok: false, status: 400, text: "bad" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized bodies", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("too-long", { status: 200, statusText: "OK" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchTextWithRetry("https://example.test", undefined, {
        maxResponseChars: 4,
        retries: 0,
      }),
    ).rejects.toThrow("exceeded 4 characters");
  });

  it("retries transport errors", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network reset"))
      .mockResolvedValueOnce(
        new Response("ok", { status: 200, statusText: "OK" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchTextWithRetry("https://example.test", undefined, {
        retries: 1,
        retryDelayMs: 1,
      }),
    ).resolves.toMatchObject({ ok: true, text: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
