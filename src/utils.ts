import type { DiffSource, ReviewResult } from "./types.js";

/**
 * Shell executor interface — abstracted so we can mock it in tests.
 */
export interface ShellExecutor {
  (cmd: string): Promise<string>;
}

/**
 * Parse the /review command arguments into a DiffSource.
 *
 * Supported formats:
 *   - (empty)       → unstaged changes
 *   - "staged"      → staged changes
 *   - "last-commit" → diff of last commit
 *   - "file1 file2" → specific files
 */
export function parseDiffSource(args: string): DiffSource {
  const trimmed = args.trim();

  if (!trimmed) {
    return { type: "unstaged" };
  }

  if (trimmed === "staged") {
    return { type: "staged" };
  }

  if (trimmed === "last-commit") {
    return { type: "last-commit" };
  }

  // Treat as file paths (space-separated)
  const paths = trimmed.split(/\s+/).filter(Boolean);
  return { type: "files", paths };
}

/**
 * Build the git command for the given diff source.
 */
export function buildDiffCommand(source: DiffSource): string {
  switch (source.type) {
    case "unstaged":
      return "git diff";
    case "staged":
      return "git diff --cached";
    case "last-commit":
      return "git diff HEAD~1";
    case "files":
      // For files we concatenate them with cat
      return source.paths.map((p) => `cat "${p}"`).join(" && echo '---' && ");
  }
}

/**
 * Gather the diff content using the shell.
 */
export async function gatherDiff(
  source: DiffSource,
  exec: ShellExecutor,
): Promise<string> {
  const cmd = buildDiffCommand(source);
  const output = await exec(cmd);

  if (!output.trim()) {
    if (source.type === "unstaged") {
      return "No unstaged changes found. Nothing to review.";
    }
    if (source.type === "staged") {
      return "No staged changes found. Nothing to review.";
    }
    if (source.type === "last-commit") {
      return "No changes in last commit. Nothing to review.";
    }
    return "No content found for the specified files.";
  }

  return output;
}

/**
 * Format a single review result as markdown.
 */
export function formatReviewResult(result: ReviewResult): string {
  const statusIcon = result.success ? "\u2705" : "\u274C";
  const header = `### ${statusIcon} ${result.reviewer} (${result.model})`;
  const duration = `*Completed in ${(result.durationMs / 1000).toFixed(1)}s*`;

  if (!result.success) {
    return `${header}\n${duration}\n\n**Error:** ${result.error ?? "Unknown error"}\n`;
  }

  return `${header}\n${duration}\n\n${result.content ?? ""}\n`;
}

/**
 * Format all review results into a combined markdown document
 * suitable for feeding to the synthesizer.
 */
export function formatReviewsForSynthesis(results: ReviewResult[]): string {
  const sections = results.map((r) => formatReviewResult(r));

  return `# Individual Code Reviews

The following reviews were conducted in parallel by different AI reviewers,
each focusing on a specific aspect of the code.

${sections.join("\n---\n\n")}`;
}

/**
 * Format the final council report as markdown.
 */
export function formatCouncilReport(
  synthesis: string,
  results: ReviewResult[],
  totalDurationMs: number,
): string {
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const duration = (totalDurationMs / 1000).toFixed(1);

  let report = `# Code Review Council Report

**Reviewers:** ${results.length} (${successful} succeeded`;
  if (failed > 0) {
    report += `, ${failed} failed`;
  }
  report += `)
**Total time:** ${duration}s

---

## Synthesized Review

${synthesis}

---

## Individual Reviews

`;

  report += results.map((r) => formatReviewResult(r)).join("\n---\n\n");

  return report;
}

/**
 * Run promises with a concurrency limit.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrent: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result);
    });
    const wrapped = p.then(() => {
      executing.delete(wrapped);
    });
    executing.add(wrapped);

    if (executing.size >= maxConcurrent) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Create a promise that rejects after a timeout.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
