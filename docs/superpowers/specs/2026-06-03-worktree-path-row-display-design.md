# Worktree Path Row Display Design

## Goal

Show each branch row's full worktree path directly in the left branch list so worktree directories are visible without opening the detail panel.

## Scope

This feature changes only `BranchRow` rendering in the left branch list.

In scope:

- Show the full `branch.worktree.path` for rows that have a worktree.
- Place the path on its own line above the existing commit metadata line.
- Keep the existing branch name and worktree/dirty badges unchanged.
- Keep non-worktree branch rows on the existing two-line layout.
- Keep the full path in the path line's `title`.

Out of scope:

- Changing Git snapshot data, worktree parsing, refresh behavior, or persistence.
- Changing the branch detail Status tab, terminal tab, or worktree actions.
- Adding copy actions, path shortening, or directory-name-only display in the branch list.

## UI

For a worktree row, render:

```text
feature/example     worktree
/Users/example/project-feature
Fix branch status · 2h ago
```

For a dirty worktree row, the existing dirty badge remains:

```text
feature/example     dirty
/Users/example/project-feature
Fix branch status · 2h ago
```

For a row without a worktree, the current layout remains:

```text
feature/example
Fix branch status · 2h ago
```

The path line is a single line with CSS truncation to protect the list layout. The value displayed is the full raw path from `branch.worktree.path`; truncation is visual only.

## Data Flow

`BranchRow` already receives `branch.worktree.path`. The component should render that value directly when present. No additional selector, store state, or RPC data is needed.

## Testing

Add renderer row tests that verify:

- Worktree rows render the full worktree path above commit metadata.
- Non-worktree rows do not render a worktree path line.
- The existing action gate and source-label behavior stays intact.

Run:

```sh
bun run test src/renderer/components/branch-list/BranchRow.test.tsx
bun run typecheck
```

## Acceptance Criteria

- A branch with `branch.worktree.path` shows that full path in the left list row.
- The path appears above the commit message and timestamp line.
- Non-worktree branches keep the existing compact layout.
- The implementation does not change worktree data loading or detail-panel behavior.
