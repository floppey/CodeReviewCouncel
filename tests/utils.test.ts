import { describe, it, expect, vi } from "vitest";
import {
  parseDiffSource,
  buildGitDiffCommand,
  gatherDiff,
  formatReviewResult,
  formatReviewsForSynthesis,
  formatCouncilReport,
  runWithConcurrency,
  withTimeout,
  parseModelString,
} from "../src/utils.js";
import type { FileReader } from "../src/utils.js";
import type { ReviewResult, DiffSource } from "../src/types.js";

describe("parseDiffSource", () => {
  it("returns unstaged for empty string", () => {
    expect(parseDiffSource("")).toEqual({ type: "unstaged" });
  });

  it("returns unstaged for whitespace-only", () => {
    expect(parseDiffSource("   ")).toEqual({ type: "unstaged" });
  });

  it("returns staged for 'staged'", () => {
    expect(parseDiffSource("staged")).toEqual({ type: "staged" });
  });

  it("returns last-commit for 'last-commit'", () => {
    expect(parseDiffSource("last-commit")).toEqual({ type: "last-commit" });
  });

  it("returns repo for 'repo'", () => {
    expect(parseDiffSource("repo")).toEqual({ type: "repo" });
  });

  it("returns files for file paths", () => {
    expect(parseDiffSource("src/foo.ts src/bar.ts")).toEqual({
      type: "files",
      paths: ["src/foo.ts", "src/bar.ts"],
    });
  });

  it("trims input before parsing", () => {
    expect(parseDiffSource("  staged  ")).toEqual({ type: "staged" });
  });

  it("handles single file path", () => {
    expect(parseDiffSource("main.ts")).toEqual({
      type: "files",
      paths: ["main.ts"],
    });
  });

  it("handles quoted paths with spaces", () => {
    expect(parseDiffSource('"path with spaces/file.ts" other.ts')).toEqual({
      type: "files",
      paths: ["path with spaces/file.ts", "other.ts"],
    });
  });

  it("handles single-quoted paths with spaces", () => {
    expect(parseDiffSource("'my dir/test.ts'")).toEqual({
      type: "files",
      paths: ["my dir/test.ts"],
    });
  });
});

describe("buildGitDiffCommand", () => {
  it("builds git diff for unstaged", () => {
    expect(buildGitDiffCommand({ type: "unstaged" })).toBe("git diff");
  });

  it("builds git diff --cached for staged", () => {
    expect(buildGitDiffCommand({ type: "staged" })).toBe("git diff --cached");
  });

  it("builds git diff HEAD~1 for last-commit", () => {
    expect(buildGitDiffCommand({ type: "last-commit" })).toBe("git diff HEAD~1");
  });
});

describe("gatherDiff", () => {
  it("returns content for non-empty unstaged diff", async () => {
    const exec = vi.fn().mockResolvedValue("+ added line\n- removed line\n");
    const result = await gatherDiff({ type: "unstaged" }, exec);

    expect(exec).toHaveBeenCalledWith("git diff");
    expect(result).toEqual({ content: "+ added line\n- removed line\n" });
  });

  it("returns empty message for empty unstaged diff", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const result = await gatherDiff({ type: "unstaged" }, exec);
    expect("empty" in result).toBe(true);
    if ("empty" in result) {
      expect(result.empty).toContain("No unstaged changes");
    }
  });

  it("returns empty message for empty staged diff", async () => {
    const exec = vi.fn().mockResolvedValue("  ");
    const result = await gatherDiff({ type: "staged" }, exec);
    expect("empty" in result).toBe(true);
    if ("empty" in result) {
      expect(result.empty).toContain("No staged changes");
    }
  });

  it("returns empty message for empty last-commit diff", async () => {
    const exec = vi.fn().mockResolvedValue("\n");
    const result = await gatherDiff({ type: "last-commit" }, exec);
    expect("empty" in result).toBe(true);
    if ("empty" in result) {
      expect(result.empty).toContain("No changes in last commit");
    }
  });

  it("returns empty message for empty repo (no tracked files)", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const result = await gatherDiff({ type: "repo" }, exec);
    expect("empty" in result).toBe(true);
    if ("empty" in result) {
      expect(result.empty).toContain("No tracked files");
    }
  });

  it("reads repo files via fileReader, not shell", async () => {
    const exec = vi.fn().mockResolvedValue("a.ts\nb.ts\n");
    const fileReader: FileReader = vi.fn()
      .mockResolvedValueOnce("content of a")
      .mockResolvedValueOnce("content of b") as unknown as FileReader;

    const result = await gatherDiff({ type: "repo" }, exec, fileReader);

    expect(exec).toHaveBeenCalledWith("git ls-files");
    expect(fileReader).toHaveBeenCalledWith("a.ts");
    expect(fileReader).toHaveBeenCalledWith("b.ts");
    expect("content" in result).toBe(true);
    if ("content" in result) {
      expect(result.content).toContain("content of a");
      expect(result.content).toContain("content of b");
    }
  });

  it("reads specific files via fileReader", async () => {
    const exec = vi.fn();
    const fileReader: FileReader = vi.fn()
      .mockResolvedValueOnce("file content") as unknown as FileReader;

    const result = await gatherDiff(
      { type: "files", paths: ["test.ts"] },
      exec,
      fileReader,
    );

    expect(exec).not.toHaveBeenCalled();
    expect(fileReader).toHaveBeenCalledWith("test.ts");
    expect("content" in result).toBe(true);
  });

  it("returns empty for files with no paths", async () => {
    const exec = vi.fn();
    const fileReader: FileReader = vi.fn() as unknown as FileReader;

    const result = await gatherDiff(
      { type: "files", paths: [] },
      exec,
      fileReader,
    );

    expect("empty" in result).toBe(true);
    if ("empty" in result) {
      expect(result.empty).toContain("No content found");
    }
  });

  it("handles fileReader errors gracefully", async () => {
    const exec = vi.fn();
    const fileReader: FileReader = vi.fn()
      .mockRejectedValueOnce(new Error("ENOENT")) as unknown as FileReader;

    const result = await gatherDiff(
      { type: "files", paths: ["missing.ts"] },
      exec,
      fileReader,
    );

    // Should still return content (with error message), not throw
    expect("content" in result).toBe(true);
    if ("content" in result) {
      expect(result.content).toContain("[Error: could not read file]");
    }
  });
});

describe("formatReviewResult", () => {
  it("formats a successful review", () => {
    const result: ReviewResult = {
      reviewer: "reviewer-security",
      model: "anthropic/claude-opus-4-20250514",
      success: true,
      content: "No issues found.",
      durationMs: 5432,
    };
    const formatted = formatReviewResult(result);

    expect(formatted).toContain("✅");
    expect(formatted).toContain("reviewer-security");
    expect(formatted).toContain("5.4s");
    expect(formatted).toContain("No issues found.");
  });

  it("formats a failed review", () => {
    const result: ReviewResult = {
      reviewer: "reviewer-bugs",
      model: "openai/gpt-4o",
      success: false,
      error: "Timed out after 120000ms",
      durationMs: 120000,
    };
    const formatted = formatReviewResult(result);

    expect(formatted).toContain("❌");
    expect(formatted).toContain("reviewer-bugs");
    expect(formatted).toContain("Error:");
    expect(formatted).toContain("Timed out");
  });

  it("handles missing error message", () => {
    const result: ReviewResult = {
      reviewer: "reviewer-quality",
      model: "openai/gpt-4o",
      success: false,
      durationMs: 1000,
    };
    const formatted = formatReviewResult(result);
    expect(formatted).toContain("Unknown error");
  });
});

describe("formatReviewsForSynthesis", () => {
  it("combines multiple reviews into a document", () => {
    const reviews: ReviewResult[] = [
      {
        reviewer: "reviewer-security",
        model: "anthropic/claude-opus-4-20250514",
        success: true,
        content: "Security review content",
        durationMs: 3000,
      },
      {
        reviewer: "reviewer-quality",
        model: "anthropic/claude-opus-4-20250514",
        success: true,
        content: "Quality review content",
        durationMs: 4000,
      },
    ];

    const formatted = formatReviewsForSynthesis(reviews);
    expect(formatted).toContain("Individual Code Reviews");
    expect(formatted).toContain("Security review content");
    expect(formatted).toContain("Quality review content");
  });
});

describe("formatCouncilReport", () => {
  it("includes synthesis and individual reviews", () => {
    const reviews: ReviewResult[] = [
      {
        reviewer: "reviewer-security",
        model: "anthropic/claude-opus-4-20250514",
        success: true,
        content: "All clear",
        durationMs: 3000,
      },
    ];

    const report = formatCouncilReport(
      "Everything looks good.",
      reviews,
      5000,
    );

    expect(report).toContain("Code Review Council Report");
    expect(report).toContain("Everything looks good.");
    expect(report).toContain("1 succeeded");
    expect(report).toContain("5.0s");
    expect(report).toContain("All clear");
  });

  it("reports failures in the count", () => {
    const reviews: ReviewResult[] = [
      {
        reviewer: "a",
        model: "m/m",
        success: true,
        content: "ok",
        durationMs: 1000,
      },
      {
        reviewer: "b",
        model: "m/m",
        success: false,
        error: "fail",
        durationMs: 1000,
      },
    ];

    const report = formatCouncilReport("Synthesis", reviews, 2000);
    expect(report).toContain("1 succeeded");
    expect(report).toContain("1 failed");
  });
});

describe("runWithConcurrency", () => {
  it("runs all tasks and returns results in order", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];

    const results = await runWithConcurrency(tasks, 2);
    expect(results).toHaveLength(3);
    // Results should preserve input order (fix #3)
    expect(results).toEqual([1, 2, 3]);
  });

  it("preserves order even with different completion times", async () => {
    const tasks = [
      () => new Promise<string>((r) => setTimeout(() => r("slow"), 50)),
      () => Promise.resolve("fast"),
      () => new Promise<string>((r) => setTimeout(() => r("medium"), 20)),
    ];

    const results = await runWithConcurrency(tasks, 3);
    expect(results).toEqual(["slow", "fast", "medium"]);
  });

  it("respects concurrency limit", async () => {
    let running = 0;
    let maxRunning = 0;

    const createTask = (val: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      return val;
    };

    const tasks = [createTask(1), createTask(2), createTask(3), createTask(4)];
    await runWithConcurrency(tasks, 2);

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("handles empty tasks array", async () => {
    const results = await runWithConcurrency([], 3);
    expect(results).toEqual([]);
  });
});

describe("withTimeout", () => {
  it("resolves if promise completes in time", async () => {
    const result = await withTimeout(
      Promise.resolve("ok"),
      1000,
      "test",
    );
    expect(result).toBe("ok");
  });

  it("rejects if promise exceeds timeout", async () => {
    const slowPromise = new Promise((resolve) =>
      setTimeout(resolve, 5000),
    );

    await expect(
      withTimeout(slowPromise, 10, "slow-task"),
    ).rejects.toThrow("slow-task timed out after 10ms");
  });

  it("propagates original promise rejection", async () => {
    const failPromise = Promise.reject(new Error("original error"));

    await expect(
      withTimeout(failPromise, 1000, "test"),
    ).rejects.toThrow("original error");
  });
});

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
