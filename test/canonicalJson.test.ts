import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonicalJson";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(
      canonicalJson({
        z: 1,
        a: { d: true, b: ["x", { y: 2, c: null }] },
      }),
    ).toBe('{"a":{"b":["x",{"c":null,"y":2}],"d":true},"z":1}');
  });

  it("omits undefined object fields", () => {
    expect(canonicalJson({ b: undefined, a: 1 })).toBe('{"a":1}');
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(
      "non-finite numbers",
    );
  });
});
