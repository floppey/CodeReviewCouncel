import { describe, it, expect } from "vitest";
import { resolveConfig, extractCouncilConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("returns defaults when no config provided", () => {
    const config = resolveConfig();

    expect(config.reviewers).toHaveLength(3);
    expect(config.reviewers[0].agent).toBe("reviewer-security");
    expect(config.reviewers[1].agent).toBe("reviewer-quality");
    expect(config.reviewers[2].agent).toBe("reviewer-bugs");
    expect(config.maxConcurrent).toBe(3);
    expect(config.defaultTimeout).toBe(120_000);
    expect(config.synthesizer.model).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
  });

  it("returns defaults when empty config provided", () => {
    const config = resolveConfig({});

    expect(config.reviewers).toHaveLength(3);
    expect(config.maxConcurrent).toBe(3);
  });

  it("overrides reviewers when provided", () => {
    const config = resolveConfig({
      reviewers: [
        { agent: "my-reviewer", model: "openai/gpt-4o" },
      ],
    });

    expect(config.reviewers).toHaveLength(1);
    expect(config.reviewers[0].agent).toBe("my-reviewer");
    expect(config.reviewers[0].model).toBe("openai/gpt-4o");
    expect(config.reviewers[0].timeout).toBe(120_000);
  });

  it("fills in defaults for partial reviewer configs", () => {
    const config = resolveConfig({
      reviewers: [{ agent: "custom-agent" }],
    });

    expect(config.reviewers[0].agent).toBe("custom-agent");
    // Falls back to default model from DEFAULT_REVIEWERS[0]
    expect(config.reviewers[0].model).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
  });

  it("overrides synthesizer model", () => {
    const config = resolveConfig({
      synthesizer: { model: "openai/o3" },
    });

    expect(config.synthesizer.model).toBe("openai/o3");
  });

  it("overrides maxConcurrent", () => {
    const config = resolveConfig({ maxConcurrent: 5 });
    expect(config.maxConcurrent).toBe(5);
  });

  it("overrides defaultTimeout and propagates to reviewers", () => {
    const config = resolveConfig({ defaultTimeout: 60_000 });

    expect(config.defaultTimeout).toBe(60_000);
    for (const reviewer of config.reviewers) {
      expect(reviewer.timeout).toBe(60_000);
    }
  });

  it("reviewer-level timeout overrides defaultTimeout", () => {
    const config = resolveConfig({
      reviewers: [
        {
          agent: "fast-reviewer",
          model: "anthropic/claude-sonnet-4-20250514",
          timeout: 30_000,
        },
      ],
      defaultTimeout: 120_000,
    });

    expect(config.reviewers[0].timeout).toBe(30_000);
  });
});

describe("extractCouncilConfig", () => {
  it("extracts config from codeReviewCouncil key", () => {
    const config = extractCouncilConfig({
      codeReviewCouncil: {
        maxConcurrent: 5,
      },
    });

    expect(config.maxConcurrent).toBe(5);
    // Rest should be defaults
    expect(config.reviewers).toHaveLength(3);
  });

  it("returns defaults when codeReviewCouncil is missing", () => {
    const config = extractCouncilConfig({});

    expect(config.reviewers).toHaveLength(3);
    expect(config.maxConcurrent).toBe(3);
  });

  it("returns defaults when codeReviewCouncil is undefined", () => {
    const config = extractCouncilConfig({
      codeReviewCouncil: undefined,
    });

    expect(config.reviewers).toHaveLength(3);
  });
});
