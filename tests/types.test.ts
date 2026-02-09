import { describe, it, expect } from "vitest";
import { parseModelString } from "../src/utils.js";

describe("parseModelString", () => {
  it("parses a valid provider/model string", () => {
    const result = parseModelString("anthropic/claude-opus-4-20250514");
    expect(result).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-20250514",
    });
  });

  it("handles model IDs with multiple slashes", () => {
    const result = parseModelString("openai/gpt-4o/2025-01-01");
    expect(result).toEqual({
      providerID: "openai",
      modelID: "gpt-4o/2025-01-01",
    });
  });

  it("throws on missing slash", () => {
    expect(() => parseModelString("no-slash-here")).toThrow(
      'Invalid model format "no-slash-here"',
    );
  });

  it("throws on empty string", () => {
    expect(() => parseModelString("")).toThrow("Invalid model format");
  });
});
