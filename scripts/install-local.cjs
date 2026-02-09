const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEST = ".opencode";

// Create directories
const dirs = ["plugins", "agents", "commands"];
for (const dir of dirs) {
  fs.mkdirSync(path.join(DEST, dir), { recursive: true });
}

// Bundle the plugin into a single file using esbuild.
// Externalize @opencode-ai/* (provided by host) and node builtins.
const pluginDest = path.join(DEST, "plugins", "code-review-council.js");
execSync(
  [
    "npx esbuild dist/index.js",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--external:@opencode-ai/plugin",
    "--external:@opencode-ai/sdk",
    `--outfile=${pluginDest}`,
  ].join(" "),
  { stdio: "inherit" },
);
console.log("Bundled plugin to " + pluginDest);

for (const dir of ["agents", "commands"]) {
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".md")) {
      fs.copyFileSync(path.join(dir, file), path.join(DEST, dir, file));
    }
  }
}

// Copy default config if one doesn't already exist
const configDest = path.join(DEST, "code-review-council.json");
if (!fs.existsSync(configDest)) {
  const defaultConfig = {
    reviewers: [
      { agent: "reviewer-security", model: "anthropic/claude-sonnet-4-20250514" },
      { agent: "reviewer-quality", model: "anthropic/claude-sonnet-4-20250514" },
      { agent: "reviewer-bugs", model: "anthropic/claude-sonnet-4-20250514" },
    ],
    synthesizer: { model: "anthropic/claude-sonnet-4-20250514" },
    maxConcurrent: 3,
    defaultTimeout: 120000,
  };
  fs.writeFileSync(configDest, JSON.stringify(defaultConfig, null, 2) + "\n");
  console.log("Created default config at " + configDest);
}

console.log("Plugin installed to .opencode/");
