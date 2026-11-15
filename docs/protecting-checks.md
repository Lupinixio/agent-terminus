# Protecting the checks

A limit is only as strong as the hardest-to-skip place that enforces it. The kit
uses three tiers. Use all three; only the last one cannot be bypassed locally.

| Tier | What it does | What it does not stop |
|---|---|---|
| 1. Agent hook (`hooks/protect-boundaries.mjs`) | Before an agent edits a protected path (or runs a shell command naming one), asks the human, or denies with `hook.decision = "deny"`. | Scripts that write without naming the path; edits made outside the agent; anyone who edits the hook settings with approval. Shell detection is best effort. |
| 2. Git pre-commit (`.githooks/pre-commit`) | Runs `boundaries check` (including generated-file and CODEOWNERS freshness) and `boundaries lint-rules` before each commit. | `git commit --no-verify`, clones that never ran `git config core.hooksPath .githooks`. |
| 3. Server: CODEOWNERS + branch protection + required CI job | A pull request cannot merge until the `boundaries` job passes and a code owner approves changes to protected paths. | Nothing local. Admins can still bypass it unless the bypass list is empty. |

## Tier 1: the agent hook

`boundaries init --claude` copies the hook to `.claude/hooks/` and registers it
as a Claude Code `PreToolUse` hook for `Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell`.

- Protected globs: the built-in list plus `.boundaries/generated/index.json`.
  If the index exists but does not parse, the hook asks (fail closed).
- File tools: the target path, relative to the nearest folder containing
  `.boundaries/`, is matched against the globs (case-insensitive on Windows).
- Shell tools: a command mentioning `.boundaries` or the literal prefix of a
  protected glob gets the decision unless every segment is read-only (`cat`,
  `grep`, `git diff`, `boundaries check`...). Any remaining `>` counts as a write.
- Other tools can import `decide()` from `agent-terminus/hook` and map its result
  to their own format.

## Tier 2: pre-commit

`boundaries init --git-hook` writes `.githooks/pre-commit` with the commands for
the languages it detects, and prints the one command to enable it:

```sh
git config core.hooksPath .githooks
```

## Tier 3: GitHub settings

1. Copy the workflow: `boundaries init --with-ci` writes
   `.github/workflows/boundaries.yml` from `templates/github/boundaries.yml` with a
   job per language (`boundaries / python`, `boundaries / node`).
2. Add the CODEOWNERS block: `boundaries codeowners --owner @your-org/boundary-owners`
   prints a block between `# BEGIN agent-terminus` and `# END agent-terminus`, one
   line per protected path. Put it in `.github/CODEOWNERS`, `CODEOWNERS` or
   `docs/CODEOWNERS` (the only locations GitHub reads). The owners need write
   access to the repository. Once the markers exist, `boundaries check` (Node)
   fails with exit 4 when the block no longer covers every protected path.
3. In **Settings → Rules → Rulesets** (or **Settings → Branches → Branch
   protection rules**) for the default branch, enable:
   - **Require a pull request before merging**;
   - **Require review from Code Owners**;
   - **Dismiss stale pull request approvals when new commits are pushed**;
   - **Require status checks to pass**, with `boundaries / python` and/or
     `boundaries / node`, and **Require branches to be up to date before merging**;
   - **Block force pushes**;
   - an empty bypass list (rulesets), or **Do not allow bypassing the above
     settings** (branch protection).

On pull requests the workflow also runs `boundaries diff --base origin/<base>`:
any change under `.boundaries/` must add a new decision record.

## Other CI systems

Run the same three commands in a required job:

```sh
boundaries check          # each adapter
boundaries lint-rules     # Node CLI
boundaries diff --base <default branch>   # on merge requests
```

On GitLab, use a protected branch with **Code owner approval** (CODEOWNERS in the
repository root, `.gitlab/` or `docs/`) and **Pipelines must succeed**.
