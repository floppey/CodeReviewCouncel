import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { loadConfigFile } from "./config.js";
import { parseDiffSource, gatherDiff, formatCouncilReport } from "./utils.js";
import type { ShellExecutor } from "./utils.js";
import { runCouncil } from "./orchestrator.js";
import type { CouncilConfig, OpencodeClient } from "./types.js";

/**
 * Run the full review workflow: parse source, gather diff, run council, format report.
 * Shared by both the slash command and the tool invocation.
 *
 * Returns the formatted report string, or an early-exit message when there's nothing to review.
 */
async function executeReview(
  args: string,
  sessionID: string,
  client: OpencodeClient,
  config: CouncilConfig,
  exec: ShellExecutor,
): Promise<string> {
  const diffSource = parseDiffSource(args);
  const diffResult = await gatherDiff(diffSource, exec);

  // Typed return: { empty: string } means nothing to review
  if ("empty" in diffResult) {
    return diffResult.empty;
  }

  const report = await runCouncil(
    client,
    config,
    diffResult.content,
    sessionID,
  );

  return formatCouncilReport(
    report.synthesis,
    report.reviews,
    report.totalDurationMs,
  );
}

const plugin: Plugin = async (input) => {
  const { client, $, directory } = input;

  // Load config from .opencode/code-review-council.json
  const councilConfig = loadConfigFile(directory);

  // Shell executor: only used for git commands (diff, ls-files).
  // $.nothrow() prevents throwing on non-zero exit codes (e.g. empty git diff).
  const exec: ShellExecutor = async (cmd: string): Promise<string> => {
    const result = await $.nothrow()`${cmd}`;
    return result.text();
  };

  return {
    "command.execute.before": async (commandInput, output) => {
      if (commandInput.command !== "review") {
        return;
      }

      const text = await executeReview(
        commandInput.arguments,
        commandInput.sessionID,
        client,
        councilConfig,
        exec,
      );

      output.parts.push({
        type: "text" as "text",
        text,
        id: "",
        sessionID: commandInput.sessionID,
        messageID: "",
      });
    },

    tool: {
      "code-review-council": tool({
        description:
          "Run a multi-agent code review council that reviews code changes in parallel using different AI reviewers (security, quality, bugs) and synthesizes the results.",
        args: {
          source: tool.schema
            .string()
            .optional()
            .describe(
              'What to review: "staged", "last-commit", "repo" (entire repo), or space-separated file paths. Empty = unstaged changes.',
            ),
        },
        execute: async (args, context) => {
          return executeReview(
            args.source ?? "",
            context.sessionID,
            client,
            councilConfig,
            exec,
          );
        },
      }),
    },
  };
};

export default plugin;
