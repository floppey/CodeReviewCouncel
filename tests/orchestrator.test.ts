import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCouncil } from "../src/orchestrator.js";
import type { CouncilConfig, OpencodeClient } from "../src/types.js";

/**
 * Create a mock OpencodeClient that simulates the SDK session API.
 */
function createMockClient(options?: {
  promptResponse?: (agent: string) => { text: string } | { error: string };
  createSessionError?: boolean;
}): OpencodeClient {
  let sessionCounter = 0;

  const mockClient = {
    session: {
      create: vi.fn().mockImplementation(async () => {
        if (options?.createSessionError) {
          return { data: undefined };
        }
        sessionCounter++;
        return {
          data: {
            id: `session-${sessionCounter}`,
            title: "",
            projectID: "proj-1",
            directory: "/test",
            version: "1",
            time: { created: Date.now(), updated: Date.now() },
          },
        };
      }),
      prompt: vi.fn().mockImplementation(async (opts: {
        path: { id: string };
        body: { agent?: string; parts: Array<{ type: string; text: string }> };
      }) => {
        const agent = opts.body.agent ?? "unknown";

        if (options?.promptResponse) {
          const response = options.promptResponse(agent);
          if ("error" in response) {
            throw new Error(response.error);
          }
          return {
            data: {
              info: {
                id: "msg-1",
                sessionID: opts.path.id,
                role: "assistant" as const,
                time: { created: Date.now() },
                parentID: "parent-1",
                modelID: "test-model",
                providerID: "test-provider",
                mode: "test",
                path: { cwd: "/test", root: "/test" },
                cost: 0,
                tokens: {
                  input: 100,
                  output: 200,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              },
              parts: [
                {
                  id: "part-1",
                  sessionID: opts.path.id,
                  messageID: "msg-1",
                  type: "text" as const,
                  text: response.text,
                },
              ],
            },
          };
        }

        return {
          data: {
            info: {
              id: "msg-1",
              sessionID: opts.path.id,
              role: "assistant" as const,
              time: { created: Date.now() },
              parentID: "parent-1",
              modelID: "test-model",
              providerID: "test-provider",
              mode: "test",
              path: { cwd: "/test", root: "/test" },
              cost: 0,
              tokens: {
                input: 100,
                output: 200,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
            parts: [
              {
                id: "part-1",
                sessionID: opts.path.id,
                messageID: "msg-1",
                type: "text" as const,
                text: `Review from ${agent}: No issues found.`,
              },
            ],
          },
        };
      }),
    },
  } as unknown as OpencodeClient;

  return mockClient;
}

function createTestConfig(overrides?: Partial<CouncilConfig>): CouncilConfig {
  return {
    reviewers: [
      {
        agent: "reviewer-security",
        model: "test/model-1",
        timeout: 5000,
      },
      {
        agent: "reviewer-quality",
        model: "test/model-2",
        timeout: 5000,
      },
    ],
    synthesizer: {
      model: "test/synth-model",
      timeout: 5000,
    },
    maxConcurrent: 3,
    defaultTimeout: 5000,
    ...overrides,
  };
}

describe("runCouncil", () => {
  it("runs all reviewers and produces a report", async () => {
    const client = createMockClient();
    const config = createTestConfig();

    const report = await runCouncil(
      client,
      config,
      "diff content here",
      "parent-session-1",
    );

    // Should have results from both reviewers
    expect(report.reviews).toHaveLength(2);
    expect(report.reviews[0].success).toBe(true);
    expect(report.reviews[1].success).toBe(true);

    // Should have synthesis
    expect(report.synthesis).toBeTruthy();
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);

    // Verify sessions were created (2 reviewers + 1 synthesizer = 3)
    expect(client.session.create).toHaveBeenCalledTimes(3);
  });

  it("handles partial reviewer failures gracefully", async () => {
    const client = createMockClient({
      promptResponse: (agent) => {
        if (agent === "reviewer-security") {
          return { error: "Model unavailable" };
        }
        return { text: `Review from ${agent}: All good.` };
      },
    });

    const config = createTestConfig();
    const report = await runCouncil(
      client,
      config,
      "diff content",
      "parent-1",
    );

    expect(report.reviews).toHaveLength(2);

    const securityReview = report.reviews.find(
      (r) => r.reviewer === "reviewer-security",
    );
    const qualityReview = report.reviews.find(
      (r) => r.reviewer === "reviewer-quality",
    );

    expect(securityReview?.success).toBe(false);
    expect(securityReview?.error).toContain("Model unavailable");
    expect(qualityReview?.success).toBe(true);

    // Synthesis should still happen since at least one reviewer succeeded
    expect(report.synthesis).toBeTruthy();
  });

  it("reports all-failure case without running synthesizer", async () => {
    const client = createMockClient({
      promptResponse: () => ({ error: "All models down" }),
    });

    const config = createTestConfig();
    const report = await runCouncil(
      client,
      config,
      "diff content",
      "parent-1",
    );

    expect(report.reviews).toHaveLength(2);
    expect(report.reviews.every((r) => !r.success)).toBe(true);
    expect(report.synthesis).toContain("All reviewers failed");

    // Only 2 session.create calls (reviewers), no synthesizer session
    expect(client.session.create).toHaveBeenCalledTimes(2);
  });

  it("handles session creation failure", async () => {
    const client = createMockClient({ createSessionError: true });
    const config = createTestConfig();

    const report = await runCouncil(
      client,
      config,
      "diff content",
      "parent-1",
    );

    // All reviewers should fail
    expect(report.reviews).toHaveLength(2);
    expect(report.reviews.every((r) => !r.success)).toBe(true);
    expect(report.synthesis).toContain("All reviewers failed");
  });

  it("passes correct model to each reviewer", async () => {
    const client = createMockClient();
    const config = createTestConfig();

    await runCouncil(client, config, "diff", "parent-1");

    // Check that prompt calls have the correct models
    const promptCalls = vi.mocked(client.session.prompt).mock.calls;

    // First reviewer: test/model-1
    const firstCall = promptCalls[0][0] as {
      body: { model: { providerID: string; modelID: string } };
    };
    expect(firstCall.body.model.providerID).toBe("test");
    expect(firstCall.body.model.modelID).toBe("model-1");

    // Second reviewer: test/model-2
    const secondCall = promptCalls[1][0] as {
      body: { model: { providerID: string; modelID: string } };
    };
    expect(secondCall.body.model.providerID).toBe("test");
    expect(secondCall.body.model.modelID).toBe("model-2");
  });

  it("includes diff in reviewer prompts", async () => {
    const client = createMockClient();
    const config = createTestConfig();

    await runCouncil(client, config, "my-special-diff", "parent-1");

    const promptCalls = vi.mocked(client.session.prompt).mock.calls;
    for (let i = 0; i < 2; i++) {
      const call = promptCalls[i][0] as {
        body: { parts: Array<{ text: string }> };
      };
      expect(call.body.parts[0].text).toContain("my-special-diff");
    }
  });

  it("creates child sessions with parentID", async () => {
    const client = createMockClient();
    const config = createTestConfig();

    await runCouncil(client, config, "diff", "my-parent-session");

    const createCalls = vi.mocked(client.session.create).mock.calls;
    for (const call of createCalls) {
      const arg = call[0] as { body: { parentID: string } };
      expect(arg.body.parentID).toBe("my-parent-session");
    }
  });
});
