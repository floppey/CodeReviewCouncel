import { describe, it, expect, vi } from "vitest";
import {
  parseDiffSource,
  buildDiffCommand,
  gatherDiff,
  formatReviewResult,
  formatReviewsForSynthesis,
  formatCouncilReport,
  runWithConcurrency,
  withTimeout,
} from "../src/utils.js";
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
});

describe("buildDiffCommand", () => {
  it("builds git diff for unstaged", () => {
    expect(buildDiffCommand({ type: "unstaged" })).toBe("git diff");
  });

  it("builds git diff --cached for staged", () => {
    expect(buildDiffCommand({ type: "staged" })).toBe("git diff --cached");
  });

  it("builds git diff HEAD~1 for last-commit", () => {
    expect(buildDiffCommand({ type: "last-commit" })).toBe("git diff HEAD~1");
  });

  it("builds git ls-files command for repo", () => {
    const cmd = buildDiffCommand({ type: "repo" });
    expect(cmd).toContain("git ls-files");
    expect(cmd).toContain("cat");
  });

  it("builds cat commands for files", () => {
    const source: DiffSource = {
      type: "files",
      paths: ["a.ts", "b.ts"],
    };
    const cmd = buildDiffCommand(source);
    expect(cmd).toContain('cat "a.ts"');
    expect(cmd).toContain('cat "b.ts"');
  });
});

describe("gatherDiff", () => {
  it("returns diff output when non-empty", async () => {
    const exec = vi.fn().mockResolvedValue("+ added line\n- removed line\n");
    const result = await gatherDiff({ type: "unstaged" }, exec);

    expect(exec).toHaveBeenCalledWith("git diff");
    expect(result).toBe("+ added line\n- removed line\n");
  });

  it("returns message for empty unstaged diff", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const result = await gatherDiff({ type: "unstaged" }, exec);
    expect(result).toContain("No unstaged changes");
  });

  it("returns message for empty staged diff", async () => {
    const exec = vi.fn().mockResolvedValue("  ");
    const result = await gatherDiff({ type: "staged" }, exec);
    expect(result).toContain("No staged changes");
  });

  it("returns message for empty last-commit diff", async () => {
    const exec = vi.fn().mockResolvedValue("\n");
    const result = await gatherDiff({ type: "last-commit" }, exec);
    expect(result).toContain("No changes in last commit");
  });

  it("returns message for empty repo content", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const result = await gatherDiff({ type: "repo" }, exec);
    expect(result).toContain("No tracked files");
  });

  it("returns message for empty file content", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const result = await gatherDiff(
      { type: "files", paths: ["missing.ts"] },
      exec,
    );
    expect(result).toContain("No content found");
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
  it("runs all tasks and returns results", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];

    const results = await runWithConcurrency(tasks, 2);
    expect(results).toHaveLength(3);
    expect(results.sort()).toEqual([1, 2, 3]);
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
