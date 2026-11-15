# Agent snippets

Short blocks to paste into role-specific agent instructions. They assume the
project imports or copies `rules/boundaries.md` (for Claude Code:
`@.boundaries/rules.md` in `CLAUDE.md`).

## Planning agent

```markdown
Check the plan against the manifests in `.boundaries/` for every component it touches.
If a limit must change, include the exact manifest diff and a draft decision record,
both marked as needing human approval. List any limit you find only as prose as an
enforcement gap, with a proposed manifest entry.
```

## Implementing agent

```markdown
Do not edit `.boundaries/**`, generated enforcement files, providers, probes or other
protected paths unless the approved plan contains that exact diff.
```

## Testing or review agent

```markdown
Run `boundaries check` for each language adapter, `boundaries lint-rules`, and
`boundaries diff --base <default branch>` when `.boundaries/` changed. Any non-zero
exit is a FAIL. So is a weakened check, provider, probe or manifest without a new
decision record.
```
