Run the Code Review Council on your current changes.

Usage:
  /review              — Review unstaged changes
  /review staged       — Review staged changes
  /review last-commit  — Review the last commit
  /review file1 file2  — Review specific files

The council runs multiple AI reviewers in parallel (security, quality, bugs),
then synthesizes all findings into a single prioritized report.
