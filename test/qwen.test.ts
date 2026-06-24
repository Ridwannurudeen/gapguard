import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_QWEN_DEEP_MODEL,
  DEFAULT_QWEN_QUICK_MODEL,
  qwenChat,
  qwenConfigFromEnv,
  qwenModelForRole,
  type ChatMessage,
} from "../src/qwen";

const messages: ChatMessage[] = [{ role: "user", content: "return json" }];

type SentBody = {
  model: string;
  max_tokens: number;
  response_format?: { type: string };
};

function okResponse(content = '{"fadeable":false}') {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    statusText: "OK",
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): SentBody {
  const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(call[1].body)) as SentBody;
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

    const body = sentBody(fetchMock);
    expect(body.model).toBe(DEFAULT_QWEN_DEEP_MODEL);
    expect(body.max_tokens).toBe(512);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("uses the pinned quick model for quick-role calls", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await qwenChat(messages, {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      modelRole: "quick",
      retries: 0,
    });

    expect(sentBody(fetchMock).model).toBe(DEFAULT_QWEN_QUICK_MODEL);
  });

  it("keeps the legacy model override above role-specific defaults", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await qwenChat(messages, {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "legacy-model",
      deepModel: "deep-model",
      quickModel: "quick-model",
      modelRole: "quick",
      retries: 0,
    });

    expect(sentBody(fetchMock).model).toBe("legacy-model");
  });

  it("loads env model overrides for deep and quick roles", () => {
    const cfg = qwenConfigFromEnv({
      BITGET_QWEN_API_KEY: " test-key ",
      BITGET_QWEN_MODEL: " legacy-model ",
      BITGET_QWEN_DEEP_MODEL: " deep-model ",
      BITGET_QWEN_QUICK_MODEL: " quick-model ",
    });

    expect(cfg).toEqual({
      apiKey: "test-key",
      model: "legacy-model",
      deepModel: "deep-model",
      quickModel: "quick-model",
    });
    expect(qwenModelForRole({ ...cfg, modelRole: "deep" })).toBe(
      "legacy-model",
    );
    expect(qwenModelForRole({ ...cfg, modelRole: "quick" })).toBe(
      "legacy-model",
    );
    expect(
      qwenModelForRole({
        deepModel: "deep-model",
        quickModel: "quick-model",
        modelRole: "deep",
      }),
    ).toBe("deep-model");
    expect(
      qwenModelForRole({
        deepModel: "deep-model",
        quickModel: "quick-model",
        modelRole: "quick",
      }),
    ).toBe("quick-model");
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
    const fetchMock = vi.fn(
      async () =>
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
    const fetchMock = vi.fn(
      async () =>
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
