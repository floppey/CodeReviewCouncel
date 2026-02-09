# Code Review Council

An [OpenCode](https://opencode.ai) plugin that orchestrates parallel AI code reviews from multiple models and synthesizes the results into a single prioritized report.

## How It Works

1. **You run `/review`** in the OpenCode TUI
2. **Multiple AI reviewers** analyze your code in parallel, each with a distinct focus:
   - **Security** — vulnerabilities, injection attacks, credential leaks
   - **Code Quality** — structure, naming, DRY, type safety
   - **Bugs & Logic** — logic errors, edge cases, race conditions
3. **A synthesizer** reads all reviews, deduplicates findings, flags conflicts, and produces a ranked report

Each reviewer runs in its own session with its own model, so you can get perspectives from different providers simultaneously.

## Installation

```bash
npm install code-review-council
```

Then add it to your `opencode.json`:

```json
{
  "plugins": {
    "code-review-council": true
  }
}
```

## Usage

### Slash Command

```
/review              — Review unstaged changes
/review staged       — Review staged changes
/review last-commit  — Review the last commit
/review file1 file2  — Review specific files
```

### Tool

The plugin also registers a `code-review-council` tool that agents can call programmatically.

## Configuration

Add a `codeReviewCouncil` section to your `opencode.json` to customize the reviewers, models, and behavior:

```json
{
  "plugins": {
    "code-review-council": true
  },
  "codeReviewCouncil": {
    "reviewers": [
      {
        "agent": "reviewer-security",
        "model": "anthropic/claude-opus-4-20250514"
      },
      {
        "agent": "reviewer-quality",
        "model": "openai/codex-5.2"
      },
      {
        "agent": "reviewer-bugs",
        "model": "anthropic/claude-sonnet-4-20250514"
      }
    ],
    "synthesizer": {
      "model": "anthropic/claude-opus-4-20250514"
    },
    "maxConcurrent": 3,
    "defaultTimeout": 120000
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `reviewers` | `ReviewerConfig[]` | 3 default reviewers | Array of reviewer configurations |
| `reviewers[].agent` | `string` | — | Agent name (must match an agent `.md` file) |
| `reviewers[].model` | `string` | `anthropic/claude-sonnet-4-20250514` | Model in `provider/model` format |
| `reviewers[].timeout` | `number` | `defaultTimeout` | Per-reviewer timeout in ms |
| `synthesizer.model` | `string` | `anthropic/claude-sonnet-4-20250514` | Model for the synthesis step |
| `synthesizer.timeout` | `number` | `defaultTimeout` | Synthesis timeout in ms |
| `maxConcurrent` | `number` | `3` | Max reviewers running in parallel |
| `defaultTimeout` | `number` | `120000` | Default timeout per reviewer (ms) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   /review command                    │
├─────────────────────────────────────────────────────┤
│                    Orchestrator                      │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Security │  │ Quality  │  │   Bugs   │  ...      │
│  │ Reviewer │  │ Reviewer │  │ Reviewer │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
│       └──────────────┼──────────────┘                │
│                      ▼                               │
│              ┌──────────────┐                        │
│              │ Synthesizer  │                        │
│              └──────┬───────┘                        │
│                     ▼                                │
│           Unified Council Report                     │
└─────────────────────────────────────────────────────┘
```

The orchestrator core (`src/orchestrator.ts`) is deliberately separated from the plugin glue (`src/index.ts`), making it reusable outside of the OpenCode plugin system.

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run typecheck

# Run tests
npm run test

# Build
npm run build
```

## License

MIT
