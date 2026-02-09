import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CouncilConfig, ReviewerConfig, SynthesizerConfig } from "./types.js";

/**
 * Default reviewer configurations.
 * Users can override these via .opencode/code-review-council.json.
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
 * Raw shape of the config file (.opencode/code-review-council.json).
 * All fields optional since users may only override some.
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
 * Load the council config from .opencode/code-review-council.json
 * relative to the given project directory. Falls back to defaults
 * if the file doesn't exist or is invalid.
 */
export function loadConfigFile(directory: string): CouncilConfig {
  const configPath = join(directory, ".opencode", "code-review-council.json");
  try {
    const content = readFileSync(configPath, "utf-8");
    const raw = JSON.parse(content) as RawCouncilConfig;
    return resolveConfig(raw);
  } catch {
    // File doesn't exist or is invalid — use defaults
    return resolveConfig();
  }
}
