# Worktree Source Branch Display Design

## Goal

Show which branch a worktree branch was created from in the left branch list.

The source branch is creation context, not Git upstream tracking. For example, a worktree branch `feature/ssh-shell` created from `main` should show `from main`. Existing worktrees that were not created after this feature may show a best-effort inferred source from Git reflog, clearly marked as inferred.

## Scope

This feature updates only the left branch list worktree rows.

In scope:

- Record exact source branch metadata for future worktrees created through Goblin.
- Infer source branch metadata for existing worktrees from Git reflog when possible.
- Visually distinguish exact and inferred source values.
- Persist Goblin-owned source metadata in the app's existing local persistence.
- Support local repositories and SSH remote repositories.

Out of scope:

- Writing metadata to the Git repository.
- Writing metadata to local Git config.
- Showing source branch in Branch status, Status, Terminal, or other detail surfaces.
- Guessing source branches from merge-base, default branch, naming conventions, or other weak signals.
- Treating upstream tracking as source branch metadata.

## Decisions

- Store exact source metadata in Goblin application persistence only.
- Prefer exact metadata over inferred metadata.
- Use reflog only as a best-effort fallback for worktrees without exact metadata.
- Mark inferred UI explicitly with `inferred from {branch}`.
- Do not surface reflog inference failures to the user.
- Prune source metadata when its branch/worktree pair no longer exists.
- Keep Git snapshot types focused on Git-discovered state; source metadata stays in renderer-owned app state.

## Architecture

The feature uses two layers:

1. Git snapshot data discovers branches, worktrees, current branch, dirty status, and related Git state.
2. Goblin source metadata records or infers the branch used to create a worktree branch.

This keeps responsibilities separate. Git remains the source of truth for what exists. Goblin metadata supplements Git with creation context that Git does not expose as a durable first-class field.

Source metadata is keyed by repository, branch, and worktree path:

```ts
type WorktreeSourceConfidence = 'exact' | 'inferred'

interface WorktreeSourceInfo {
  branch: string
  worktreePath: string
  sourceBranch: string
  confidence: WorktreeSourceConfidence
  updatedAt: number
}
```

The renderer store owns the persisted source map:

```ts
worktreeSourcesByRepo: Record<string, Record<string, WorktreeSourceInfo>>
```

The per-entry key should combine branch and worktree path with a non-printing separator such as `\0`. This avoids accidental collisions while keeping lookup simple.

## Data Flow

### Creating a worktree

The existing create worktree flow already captures `baseBranch` in `CreateWorktreeDialog` and sends it through the branch action to local or remote RPC.

After `createWorktree` returns `ok: true`, the renderer records an exact source entry:

- `branch`: the new branch name
- `worktreePath`: the created worktree path
- `sourceBranch`: the selected base branch
- `confidence`: `exact`
- `updatedAt`: current timestamp

Cancelled or failed create actions do not record source metadata.

### Refreshing a repository

Snapshot refresh continues to load Git branches and worktrees as it does today. After live worktree branches are known:

1. Prune source entries for branch/worktree pairs that no longer exist.
2. Preserve exact entries for live worktree branches.
3. For live worktree branches without exact entries, request reflog inference.
4. Merge valid inferred entries without overwriting exact entries.

Reflog inference is an enhancement to snapshot data, not a prerequisite. If inference fails or returns no usable source, the branch row simply does not show source metadata.

## Reflog Inference

Git does not provide a durable source branch field for worktrees. It may, however, keep reflog messages such as:

```text
branch: Created from main
```

The main-process Git layer should expose a small read-only helper that accepts a repository and a list of branch names, then returns inferred source metadata for branches whose reflog contains this clear creation message.

Parsing rules:

- Accept only clear `Created from <ref>` reflog messages.
- Validate the parsed ref with existing safe branch/ref validation before returning it.
- Reject empty values.
- Reject values equal to the target branch name.
- Return no result when reflog is unavailable, expired, disabled, or unparseable.

Local repositories use a local repo RPC query. SSH remote repositories use a remote RPC query that runs the equivalent Git command on the SSH host.

No merge-base or naming-rule inference is used. Those signals can be plausible but are not reliable enough for a branch-list label.

## UI

Only `BranchRow` changes visually.

For a worktree branch with exact source metadata:

```text
from main
```

For a worktree branch with inferred source metadata:

```text
inferred from main
```

The label appears in the top badge row next to existing worktree/dirty badges. Exact source uses a restrained neutral or brand badge. Inferred source uses a visually distinct warning/outline treatment so the user can tell it is best-effort.

The row title and accessible label include the source text. Non-worktree branches never show source metadata.

## Persistence

Source metadata is persisted through the existing Zustand persistence layer, separate from `repoCache`.

It should not be folded into `BranchSnapshotInfo` because exact source data is not produced by Git snapshot parsing. It should also not be stored only inside local repo snapshot cache because:

- remote repositories do not use `repoCache`;
- source metadata should not be coupled to branch snapshot expiration;
- exact creation metadata should survive ordinary snapshot refreshes.

The persisted shape is normalized during hydration:

- Drop malformed entries.
- Drop entries with invalid branch, path, or source values.
- Preserve `exact` and `inferred` confidence values.
- Allow future pruning after the repo is opened and live worktrees are known.

## Error Handling

- Reflog inference failures are silent.
- Remote inference failures are silent, including SSH permission, network, timeout, or unavailable repository errors.
- Exact source writes occur only after a successful create result.
- Inferred results never overwrite exact results.
- Invalid source values are ignored.
- Missing source metadata is a normal state and renders no badge.
- Stale metadata is pruned when a refreshed live worktree set no longer contains its branch/worktree pair.

## Testing

Add or update tests for:

- Local Git reflog inference parses `branch: Created from main`.
- Local inference ignores malformed, missing, self-referential, or unsafe source refs.
- Remote Git inference routes through the SSH Git helper and uses the same parser behavior.
- Store records exact source metadata after successful create worktree.
- Store does not record source metadata after failed or cancelled create worktree.
- Store merges inferred metadata only when exact metadata is absent.
- Store prunes metadata for removed worktrees.
- Persistence normalizes, stores, and hydrates source metadata separately from `repoCache`.
- `BranchRow` shows `from main` for exact source metadata.
- `BranchRow` shows `inferred from main` for inferred source metadata.
- `BranchRow` does not show source metadata for non-worktree branches.
- English, Chinese, Japanese, and Korean dictionaries include the new labels.

Run:

```sh
bun run test
bun run typecheck
```

## Acceptance Criteria

- A worktree created through Goblin shows its exact source branch in the left branch list after creation and after refresh.
- An existing worktree with a parseable Git reflog creation message shows an inferred source branch in the left branch list.
- Exact source metadata is not overwritten by reflog inference.
- Missing or failed inference does not show errors and does not block repository refresh.
- No project files, Git config, or repository metadata are written for source tracking.
- Source labels appear only on left branch-list worktree rows.
