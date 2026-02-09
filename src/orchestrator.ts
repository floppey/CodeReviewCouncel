import type {
  OpencodeClient,
  CouncilConfig,
  ReviewerConfig,
  ReviewResult,
  CouncilReport,
  ModelIdentifier,
} from "./types.js";
import {
  parseModelString,
  runWithConcurrency,
  withTimeout,
  formatReviewsForSynthesis,
} from "./utils.js";

/**
 * Extract text content from the prompt response parts.
 * Parts is a union type; we only care about TextPart (type === "text").
 */
function extractTextFromParts(
  parts: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && typeof p.text === "string",
    )
    .map((p) => p.text)
    .join("\n");
}

/**
 * Run a single reviewer session: create a child session, send the diff
 * as a prompt with the reviewer's agent and model, and return the result.
 */
async function runReviewer(
  client: OpencodeClient,
  reviewer: ReviewerConfig,
  diff: string,
  parentSessionID: string,
  defaultTimeout: number,
): Promise<ReviewResult> {
  const startTime = Date.now();
  const model: ModelIdentifier = parseModelString(reviewer.model);
  const timeout = reviewer.timeout ?? defaultTimeout;

  try {
    // Create a child session for this reviewer
    const sessionResult = await client.session.create({
      body: {
        parentID: parentSessionID,
        title: `Review: ${reviewer.agent}`,
      },
    });

    if (!sessionResult.data) {
      throw new Error(
        `Failed to create session for ${reviewer.agent}: no data returned`,
      );
    }

    const sessionID = sessionResult.data.id;

    // Send the diff to the reviewer with its specific agent and model
    const promptResult = await withTimeout(
      client.session.prompt({
        path: { id: sessionID },
        body: {
          model: {
            providerID: model.providerID,
            modelID: model.modelID,
          },
          agent: reviewer.agent,
          parts: [
            {
              type: "text" as const,
              text: `Please review the following code changes:\n\n\`\`\`diff\n${diff}\n\`\`\``,
            },
          ],
        },
      }),
      timeout,
      `Reviewer ${reviewer.agent}`,
    );

    if (!promptResult.data) {
      throw new Error(
        `No response data from ${reviewer.agent}`,
      );
    }

    // Extract text from the response parts
    // The parts array contains Part union types; we filter for TextPart
    const content = extractTextFromParts(
      promptResult.data.parts as ReadonlyArray<{ type: string; text?: string }>,
    );

    return {
      reviewer: reviewer.agent,
      model: reviewer.model,
      success: true,
      content,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    return {
      reviewer: reviewer.agent,
      model: reviewer.model,
      success: false,
      error: message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Run the synthesis step: send all review results to the synthesizer agent
 * to produce a unified, deduplicated, conflict-aware summary.
 */
async function runSynthesizer(
  client: OpencodeClient,
  config: CouncilConfig,
  reviews: ReviewResult[],
  parentSessionID: string,
): Promise<string> {
  const model = parseModelString(config.synthesizer.model);
  const timeout = config.synthesizer.timeout ?? config.defaultTimeout;

  const synthesisPrompt = formatReviewsForSynthesis(reviews);

  // Create a child session for synthesis
  const sessionResult = await client.session.create({
    body: {
      parentID: parentSessionID,
      title: "Review Synthesis",
    },
  });

  if (!sessionResult.data) {
    throw new Error("Failed to create synthesis session: no data returned");
  }

  const sessionID = sessionResult.data.id;

  const promptResult = await withTimeout(
    client.session.prompt({
      path: { id: sessionID },
      body: {
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
        },
        agent: "council-synthesizer",
        parts: [
          {
            type: "text" as const,
            text: synthesisPrompt,
          },
        ],
      },
    }),
    timeout,
    "Council Synthesizer",
  );

  if (!promptResult.data) {
    throw new Error("No response data from synthesizer");
  }

  return extractTextFromParts(
    promptResult.data.parts as ReadonlyArray<{ type: string; text?: string }>,
  );
}

/**
 * Orchestrate the full code review council:
 * 1. Run all reviewers in parallel (with concurrency limit)
 * 2. Feed results to the synthesizer
 * 3. Return the complete council report
 */
export async function runCouncil(
  client: OpencodeClient,
  config: CouncilConfig,
  diff: string,
  parentSessionID: string,
): Promise<CouncilReport> {
  const startTime = Date.now();

  // Build reviewer tasks
  const tasks = config.reviewers.map(
    (reviewer: ReviewerConfig) => () =>
      runReviewer(
        client,
        reviewer,
        diff,
        parentSessionID,
        config.defaultTimeout,
      ),
  );

  // Run reviewers in parallel with concurrency limit
  const reviews = await runWithConcurrency(tasks, config.maxConcurrent);

  // Check if we have any successful reviews
  const successfulReviews = reviews.filter((r) => r.success);
  if (successfulReviews.length === 0) {
    return {
      reviews,
      synthesis:
        "All reviewers failed. No synthesis possible. Please check the errors above.",
      totalDurationMs: Date.now() - startTime,
    };
  }

  // Run synthesis on all results (including failures, so synthesizer is aware)
  const synthesis = await runSynthesizer(
    client,
    config,
    reviews,
    parentSessionID,
  );

  return {
    reviews,
    synthesis,
    totalDurationMs: Date.now() - startTime,
  };
}
