import { afterEach, describe, expect, it, vi } from "vitest";
import { qwenChat, type ChatMessage } from "../src/qwen";

const messages: ChatMessage[] = [{ role: "user", content: "return json" }];

function okResponse(content = '{"fadeable":false}') {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, statusText: "OK" },
  );
}

describe("qwenChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caps tokens and requests JSON mode by default", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      qwenChat(messages, {
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        retries: 0,
      }),
    ).resolves.toBe('{"fadeable":false}');

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body)) as {
      max_tokens: number;
      response_format: { type: string };
    };
    expect(body.max_tokens).toBe(512);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("retries retryable status codes once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("temporary overload", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      )
      .mockResolvedValueOnce(okResponse("stable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      qwenChat(messages, {
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        retries: 1,
      }),
    ).resolves.toBe("stable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable status codes", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("bad schema", { status: 400, statusText: "Bad Request" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      qwenChat(messages, {
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        retries: 2,
      }),
    ).rejects.toThrow("Qwen request failed: 400 Bad Request bad schema");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized responses before parsing", async () => {
    const fetchMock = vi.fn(async () => okResponse("too-long"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      qwenChat(messages, {
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        maxResponseChars: 8,
        retries: 0,
      }),
    ).rejects.toThrow("exceeded 8 characters");
  });

  it("rejects malformed chat-completion shapes", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        statusText: "OK",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      qwenChat(messages, {
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        retries: 0,
      }),
    ).rejects.toThrow("missing content");
  });
});
