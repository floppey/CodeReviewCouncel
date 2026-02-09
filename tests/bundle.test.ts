import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Bundle integrity tests.
 *
 * These verify that `npm run dev` produces a self-contained plugin bundle
 * in .opencode/plugins/code-review-council.js with no broken relative imports.
 *
 * This catches the class of bug where the install script copies only index.js
 * but not its internal dependencies, causing opencode to hang on startup.
 */
describe("bundle integrity", () => {
  const bundlePath = resolve(".opencode/plugins/code-review-council.js");
  let source: string;

  beforeAll(() => {
    // Build fresh
    execSync("npm run dev", { stdio: "pipe" });
    source = readFileSync(bundlePath, "utf-8");
  });

  it("produces a bundle file", () => {
    expect(existsSync(bundlePath)).toBe(true);
  });

  it("has a default export", () => {
    expect(source).toContain("export {");
    expect(source).toContain("as default");
  });

  it("has no relative imports (all internal modules are inlined)", () => {
    // This is the critical check. The old install script only copied index.js
    // which had imports like ./config.js, ./utils.js etc. that didn't exist
    // in the plugins directory, causing opencode to hang.
    const relativeImports = source.match(/from "\.\/.+"/g);
    expect(relativeImports).toBeNull();
  });

  it("does not import ./config.js", () => {
    expect(source).not.toContain('from "./config.js"');
  });

  it("does not import ./utils.js", () => {
    expect(source).not.toContain('from "./utils.js"');
  });

  it("does not import ./orchestrator.js", () => {
    expect(source).not.toContain('from "./orchestrator.js"');
  });

  it("does not import ./types.js", () => {
    expect(source).not.toContain('from "./types.js"');
  });

  it("contains all expected inlined functions", () => {
    const expectedFunctions = [
      "loadConfigFile",
      "parseDiffSource",
      "gatherDiff",
      "runCouncil",
      "runReviewer",
      "runSynthesizer",
      "formatCouncilReport",
      "parseModelString",
      "runWithConcurrency",
      "withTimeout",
    ];
    for (const fn of expectedFunctions) {
      expect(source).toContain(`function ${fn}`);
    }
  });

  it("registers the command.execute.before hook", () => {
    expect(source).toContain('"command.execute.before"');
  });

  it("registers the code-review-council tool", () => {
    expect(source).toContain('"code-review-council"');
    expect(source).toContain("tool(");
  });

  it("only has allowed external imports", () => {
    // Extract all import sources
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    const allowed = ["@opencode-ai/plugin", "@opencode-ai/sdk", "node:fs", "node:fs/promises", "node:path"];
    for (const imp of imports) {
      expect(allowed).toContain(imp);
    }
  });
});
