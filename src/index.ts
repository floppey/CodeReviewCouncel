import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { extractCouncilConfig } from "./config.js";
import { parseDiffSource, gatherDiff, formatCouncilReport } from "./utils.js";
import type { ShellExecutor } from "./utils.js";
import { runCouncil } from "./orchestrator.js";
import type { CouncilConfig } from "./types.js";

const plugin: Plugin = async (input) => {
  const { client, $ } = input;

  // Resolve config — will be updated if config hook fires
  let councilConfig: CouncilConfig | undefined;

  // Shell executor using the BunShell provided by the plugin system.
  // We use $.nothrow() so empty diffs don't throw, then read stdout as text.
  const nothrowShell = $.nothrow();
  const exec: ShellExecutor = async (cmd: string): Promise<string> => {
    const result = await nothrowShell`${cmd}`;
    return result.text();
  };

  return {
    config: async (config) => {
      // Extract our plugin config from the full opencode config
      councilConfig = extractCouncilConfig(
        config as unknown as Record<string, unknown>,
      );
    },

    "command.execute.before": async (commandInput, output) => {
      if (commandInput.command !== "review") {
        return;
      }

      // Ensure config is loaded
      if (!councilConfig) {
        councilConfig = extractCouncilConfig({});
      }

      const diffSource = parseDiffSource(commandInput.arguments);
      const diff = await gatherDiff(diffSource, exec);

      // Check for empty diff
      if (
        diff.includes("Nothing to review.") ||
        diff.includes("No content found")
      ) {
        output.parts.push({
          type: "text" as "text",
          text: diff,
          id: "",
          sessionID: commandInput.sessionID,
          messageID: "",
        });
        return;
      }

      // Run the council
      const report = await runCouncil(
        client,
        councilConfig,
        diff,
        commandInput.sessionID,
      );

      // Format the report and push it as output parts
      const formattedReport = formatCouncilReport(
        report.synthesis,
        report.reviews,
        report.totalDurationMs,
      );

      output.parts.push({
        type: "text" as "text",
        text: formattedReport,
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
              'What to review: "staged", "last-commit", or space-separated file paths. Empty = unstaged changes.',
            ),
        },
        execute: async (args, context) => {
          // Ensure config is loaded
          if (!councilConfig) {
            councilConfig = extractCouncilConfig({});
          }

          const diffSource = parseDiffSource(args.source ?? "");
          const diff = await gatherDiff(diffSource, exec);

          if (
            diff.includes("Nothing to review.") ||
            diff.includes("No content found")
          ) {
            return diff;
          }

          const report = await runCouncil(
            client,
            councilConfig,
            diff,
            context.sessionID,
          );

          return formatCouncilReport(
            report.synthesis,
            report.reviews,
            report.totalDurationMs,
          );
        },
      }),
    },
  };
};

export default plugin;
