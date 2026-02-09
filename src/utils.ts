import { readFile } from "node:fs/promises";
import type { DiffSource, ModelIdentifier, ReviewResult } from "./types.js";

/**
 * Shell executor interface — abstracted so we can mock it in tests.
 * Used only for git commands, never for reading file contents.
 */
export interface ShellExecutor {
  (cmd: string): Promise<string>;
}

/**
 * File reader interface — abstracted so we can mock it in tests.
 * Defaults to node:fs/promises readFile.
 */
export interface FileReader {
  (path: string): Promise<string>;
}

/** Default file reader using node:fs/promises. */
export const defaultFileReader: FileReader = async (path: string) =>
  readFile(path, "utf-8");

/**
 * Parse the /review command arguments into a DiffSource.
 *
 * Supported formats:
 *   - (empty)       → unstaged changes
 *   - "staged"      → staged changes
 *   - "last-commit" → diff of last commit
 *   - "repo"        → entire repository contents
 *   - "file1 file2" → specific files (supports quoted paths for spaces)
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

  if (trimmed === "repo") {
    return { type: "repo" };
  }

  // Parse file paths, respecting quoted strings for paths with spaces.
  // Supports: "path with spaces/file.ts" normalFile.ts 'another path.ts'
  const paths: string[] = [];
  const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed)) !== null) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value) {
      paths.push(value);
    }
  }

  return { type: "files", paths };
}

/**
 * Empty-diff messages keyed by DiffSource type.
 */
const EMPTY_DIFF_MESSAGES: Record<DiffSource["type"], string> = {
  unstaged: "No unstaged changes found. Nothing to review.",
  staged: "No staged changes found. Nothing to review.",
  "last-commit": "No changes in last commit. Nothing to review.",
  repo: "No tracked files found in the repository. Nothing to review.",
  files: "No content found for the specified files.",
};

/**
 * Build the git command for diff-based sources.
 * Only used for unstaged, staged, and last-commit — NOT for repo or files.
 */
export function buildGitDiffCommand(
  source: Extract<DiffSource, { type: "unstaged" | "staged" | "last-commit" }>,
): string {
  switch (source.type) {
    case "unstaged":
      return "git diff";
    case "staged":
      return "git diff --cached";
    case "last-commit":
      return "git diff HEAD~1";
  }
}

/**
 * Read file contents safely using fs, with per-file error handling.
 * Returns a formatted string with headers for each file.
 */
async function readFilesContent(
  paths: string[],
  fileReader: FileReader,
): Promise<string> {
  const sections: string[] = [];

  for (const filePath of paths) {
    try {
      const content = await fileReader(filePath);
      sections.push(`=== ${filePath} ===\n${content}`);
    } catch {
      sections.push(`=== ${filePath} ===\n[Error: could not read file]`);
    }
  }

  return sections.join("\n\n");
}

/**
 * Gather the diff/content for review.
 * Returns null when there is nothing to review.
 *
 * - For git diff operations: uses the shell executor.
 * - For file reading (repo, files): uses fs.readFile (no shell interpolation).
 */
export async function gatherDiff(
  source: DiffSource,
  exec: ShellExecutor,
  fileReader: FileReader = defaultFileReader,
): Promise<{ content: string } | { empty: string }> {
  // Git-diff based sources
  if (
    source.type === "unstaged" ||
    source.type === "staged" ||
    source.type === "last-commit"
  ) {
    const cmd = buildGitDiffCommand(source);
    const output = await exec(cmd);
    if (!output.trim()) {
      return { empty: EMPTY_DIFF_MESSAGES[source.type] };
    }
    return { content: output };
  }

  // Repo: list tracked files via git, then read them with fs
  if (source.type === "repo") {
    const fileList = await exec("git ls-files");
    const files = fileList
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    if (files.length === 0) {
      return { empty: EMPTY_DIFF_MESSAGES.repo };
    }

    const content = await readFilesContent(files, fileReader);
    return { content };
  }

  // Specific files: read directly with fs (no shell interpolation)
  const content = await readFilesContent(source.paths, fileReader);
  if (!content.trim() || source.paths.length === 0) {
    return { empty: EMPTY_DIFF_MESSAGES.files };
  }
  return { content };
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
 * Results are returned in the same order as the input tasks.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrent: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing: Set<Promise<void>> = new Set();

  for (let i = 0; i < tasks.length; i++) {
    const index = i;
    const p = tasks[index]().then((result) => {
      results[index] = result;
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
 * Parse a "provider/model" string into a ModelIdentifier.
 * The provider is everything before the first slash; the model is the rest.
 */
export function parseModelString(model: string): ModelIdentifier {
  const slashIndex = model.indexOf("/");
  if (slashIndex <= 0) {
    throw new Error(
      `Invalid model format "${model}". Expected "provider/model" (e.g. "anthropic/claude-sonnet-4-20250514")`,
    );
  }
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  };
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
