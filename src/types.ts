import type { createOpencodeClient } from "@opencode-ai/sdk";

/**
 * The SDK client type extracted from the opencode SDK.
 */
export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

/**
 * Model identifier used to specify which provider/model to use for a reviewer.
 */
export interface ModelIdentifier {
  providerID: string;
  modelID: string;
}

/**
 * Configuration for a single reviewer in the council.
 */
export interface ReviewerConfig {
  /** Name of the agent to use (must match an agent definition) */
  agent: string;
  /** Model to use in "provider/model" format */
  model: string;
  /** Optional timeout in milliseconds (default: 120000) */
  timeout?: number;
}

/**
 * Configuration for the synthesizer that aggregates all reviews.
 */
export interface SynthesizerConfig {
  /** Model to use in "provider/model" format */
  model: string;
  /** Optional timeout in milliseconds (default: 120000) */
  timeout?: number;
}

/**
 * Full plugin configuration as read from opencode.json.
 */
export interface CouncilConfig {
  reviewers: ReviewerConfig[];
  synthesizer: SynthesizerConfig;
  /** Maximum number of concurrent reviewer sessions (default: 3) */
  maxConcurrent: number;
  /** Default timeout per reviewer in milliseconds (default: 120000) */
  defaultTimeout: number;
}

/**
 * Describes the source of a diff for review.
 */
export type DiffSource =
  | { type: "unstaged" }
  | { type: "staged" }
  | { type: "last-commit" }
  | { type: "files"; paths: string[] };

/**
 * The result of a single reviewer's analysis.
 */
export interface ReviewResult {
  /** Which reviewer agent produced this */
  reviewer: string;
  /** The model used */
  model: string;
  /** Whether the review succeeded */
  success: boolean;
  /** The review content (markdown) — present on success */
  content?: string;
  /** Error message — present on failure */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * The final synthesized report from the council.
 */
export interface CouncilReport {
  /** Individual review results */
  reviews: ReviewResult[];
  /** The synthesized summary combining all reviews */
  synthesis: string;
  /** Total duration of the review process in milliseconds */
  totalDurationMs: number;
}

/**
 * Parse a "provider/model" string into a ModelIdentifier.
 */
export function parseModelString(model: string): ModelIdentifier {
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model format "${model}". Expected "provider/model" (e.g. "anthropic/claude-opus-4-20250514")`,
    );
  }
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  };
}
