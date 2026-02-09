import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveConfig, loadConfigFile, DEFAULT_MODEL } from "../src/config.js";
import * as path from "node:path";

// Mock the entire node:fs module for ESM compatibility
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

// Import the mocked module
import { readFileSync } from "node:fs";
const mockedReadFileSync = vi.mocked(readFileSync);

describe("resolveConfig", () => {
  it("uses DEFAULT_MODEL for all defaults", () => {
    const config = resolveConfig();
    for (const reviewer of config.reviewers) {
      expect(reviewer.model).toBe(DEFAULT_MODEL);
    }
    expect(config.synthesizer.model).toBe(DEFAULT_MODEL);
  });

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

describe("loadConfigFile", () => {
  beforeEach(() => {
    mockedReadFileSync.mockReset();
  });

  it("returns defaults when config file does not exist", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const config = loadConfigFile("/fake/project");

    expect(config.reviewers).toHaveLength(3);
    expect(config.maxConcurrent).toBe(3);
    expect(config.defaultTimeout).toBe(120_000);
  });

  it("reads config from .opencode/code-review-council.json", () => {
    const customConfig = JSON.stringify({
      maxConcurrent: 5,
      synthesizer: { model: "openai/o3" },
    });
    mockedReadFileSync.mockReturnValue(customConfig);

    const config = loadConfigFile("/fake/project");

    expect(mockedReadFileSync).toHaveBeenCalledWith(
      path.join("/fake/project", ".opencode", "code-review-council.json"),
      "utf-8",
    );
    expect(config.maxConcurrent).toBe(5);
    expect(config.synthesizer.model).toBe("openai/o3");
    // Reviewers should still be defaults
    expect(config.reviewers).toHaveLength(3);
  });

  it("returns defaults when config file contains invalid JSON and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedReadFileSync.mockReturnValue("not valid json {{{");

    const config = loadConfigFile("/fake/project");

    expect(config.reviewers).toHaveLength(3);
    expect(config.maxConcurrent).toBe(3);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("[code-review-council]");
    expect(warnSpy.mock.calls[0][0]).toContain("Invalid JSON");
    warnSpy.mockRestore();
  });

  it("overrides reviewers from config file", () => {
    const customConfig = JSON.stringify({
      reviewers: [
        { agent: "custom-reviewer", model: "openai/gpt-4o" },
      ],
    });
    mockedReadFileSync.mockReturnValue(customConfig);

    const config = loadConfigFile("/fake/project");

    expect(config.reviewers).toHaveLength(1);
    expect(config.reviewers[0].agent).toBe("custom-reviewer");
    expect(config.reviewers[0].model).toBe("openai/gpt-4o");
  });
});
