import type { CouncilConfig, ReviewerConfig, SynthesizerConfig } from "./types.js";

/**
 * Default reviewer configurations.
 * Users can override these entirely via opencode.json.
 */
const DEFAULT_REVIEWERS: ReviewerConfig[] = [
  {
    agent: "reviewer-security",
    model: "anthropic/claude-sonnet-4-20250514",
  },
  {
    agent: "reviewer-quality",
    model: "anthropic/claude-sonnet-4-20250514",
  },
  {
    agent: "reviewer-bugs",
    model: "anthropic/claude-sonnet-4-20250514",
  },
];

const DEFAULT_SYNTHESIZER: SynthesizerConfig = {
  model: "anthropic/claude-sonnet-4-20250514",
};

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Raw shape of the config as it appears in opencode.json
 * (all fields optional since users may only override some).
 */
interface RawCouncilConfig {
  reviewers?: Array<{
    agent?: string;
    model?: string;
    timeout?: number;
  }>;
  synthesizer?: {
    model?: string;
    timeout?: number;
  };
  maxConcurrent?: number;
  defaultTimeout?: number;
}

/**
 * Resolve a full CouncilConfig from a partial user config, applying defaults.
 */
export function resolveConfig(raw?: RawCouncilConfig): CouncilConfig {
  const defaultTimeout = raw?.defaultTimeout ?? DEFAULT_TIMEOUT_MS;

  const reviewers: ReviewerConfig[] =
    raw?.reviewers && raw.reviewers.length > 0
      ? raw.reviewers.map((r, i) => ({
          agent: r.agent ?? DEFAULT_REVIEWERS[i]?.agent ?? `reviewer-${i}`,
          model: r.model ?? DEFAULT_REVIEWERS[i]?.model ?? DEFAULT_REVIEWERS[0].model,
          timeout: r.timeout ?? defaultTimeout,
        }))
      : DEFAULT_REVIEWERS.map((r) => ({
          ...r,
          timeout: defaultTimeout,
        }));

  const synthesizer: SynthesizerConfig = {
    model: raw?.synthesizer?.model ?? DEFAULT_SYNTHESIZER.model,
    timeout: raw?.synthesizer?.timeout ?? defaultTimeout,
  };

  return {
    reviewers,
    synthesizer,
    maxConcurrent: raw?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    defaultTimeout,
  };
}

/**
 * Extract the council config from the full opencode config object.
 * The config hook receives the entire opencode config; we look for
 * our section under "codeReviewCouncil".
 */
export function extractCouncilConfig(
  opencodeConfig: Record<string, unknown>,
): CouncilConfig {
  const raw = opencodeConfig["codeReviewCouncil"] as
    | RawCouncilConfig
    | undefined;
  return resolveConfig(raw);
}
