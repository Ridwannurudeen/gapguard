import { describe, expect, it } from "vitest";
import {
  buildSignaturePayload,
  canonicalJson,
  signBitgetRequest,
} from "../src/bitgetWalletApi";

describe("bitgetWalletApi", () => {
  it("serializes request bodies with sorted keys", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
  });

  it("builds the documented sorted signature payload", () => {
    expect(
      buildSignaturePayload(
        "/test",
        '{"body":"test"}',
        "123456",
        "1733366175000",
        { key2: "val2", key1: "val1" },
      ),
    ).toBe(
      '{"apiPath":"/test","body":"{\\"body\\":\\"test\\"}","key1":"val1","key2":"val2","x-api-key":"123456","x-api-timestamp":"1733366175000"}',
    );
  });

  it("signs with HMAC-SHA256 and base64 encoding", () => {
    expect(
      signBitgetRequest(
        "/test",
        '{"body":"test"}',
        "123456",
        "7890",
        "1733366175000",
        { key1: "val1", key2: "val2" },
      ),
    ).toBe("1cDOTjA9a7sPi6a4i3Dku4uMQItYILeBt2XJa7MGXxI=");
  });
});
