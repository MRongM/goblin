# Hide Remote Tracking Branches From Main List Design

## Goal

Hide remote-tracking branches such as `origin/feature/x` from the main branch list while keeping them available in the repo toolbar checkout menu.

The data model continues to keep remote-tracking branches in `repo.data.branches` because checkout needs the exact remote ref. The main branch list treats them as action targets, not ordinary visible branch rows.

## Decisions

- Keep snapshot parsing unchanged: local and remote repositories may still return remote-tracking branches in `repo.data.branches`.
- Hide `branch.remoteTracking === true` from main branch-list visibility and selection helpers.
- Keep `RepoToolbarActions` unchanged in behavior: it continues to read remote-tracking branches from `repo.data.branches`.
- Do not split `repo.data.branches` into separate local and remote-tracking collections for this change.
- Do not remove remote-tracking checkout, RPC, or main-process validation behavior.

## Architecture

`repo.data.branches` remains the canonical branch snapshot. This preserves the existing checkout action path and avoids touching snapshot, cache, RPC, or git parser boundaries.

The renderer adds a branch-list visibility rule before view-mode filtering:

1. Exclude remote-tracking branches.
2. Apply the current branch view mode (`all`, `worktrees`, or `no-worktree`).
3. Apply existing manual order behavior.

This rule belongs in `src/renderer/stores/repos/branch-view-mode.ts`, not directly in `BranchList`, because keyboard navigation, selection fallback, drag reorder, and list rendering all need the same visible branch set.

## Data Flow

Snapshot refresh still stores all branch rows, including hidden remote-tracking rows. `RepoToolbarActions` continues to compute checkout menu items with:

```ts
repo.data.branches.filter((branch) => branch.remoteTracking && !branch.worktreePath)
```

The main branch list and keyboard navigation use `visibleBranches(repo)`, which excludes remote-tracking branches. Selection fallback uses the same rule so a stale selected `origin/*` row falls back to the current local branch or first visible local branch after refresh or view-mode change.

## Error Handling

No new error path is introduced. Checkout failures remain handled by the existing `checkoutRemoteBranch` branch action flow.

If a repository only has remote-tracking branches and no local branches, the main branch list should show the existing empty/filter-empty state while the toolbar checkout menu remains available.

## Testing

- `visibleBranches` excludes remote-tracking branches in every branch view mode.
- `selectedBranchForBranchSet` falls back when the selected branch is a hidden remote-tracking branch.
- Manual branch ordering still applies to visible local branches and ignores hidden remote-tracking rows for drag reorder.
- Toolbar checkout menu continues to render remote-tracking branches from `repo.data.branches`.
