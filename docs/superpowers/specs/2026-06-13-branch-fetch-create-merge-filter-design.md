# Branch Fetch, Create, And Merge Filter Design

## Goal

Branch actions should support three workflows without surprising checkout or merge side effects:

- Fetch remote refs into the local repository without merging into any worktree.
- Create a local branch from a selected branch row without checking it out.
- Filter merge and checkout candidates so branches already checked out by any worktree are not offered.

Existing `Pull` behavior remains unchanged. It still means updating the target branch through the existing pull path. The new fetch action is separate and only updates remote-tracking refs and repository metadata.

## Scope

In scope:

- Add a branch-menu `Fetch Remote` action that uses fetch semantics, not pull semantics.
- Reuse the existing repository fetch backend and refresh path.
- Add a branch-menu `Create Branch` action that creates a local branch from the selected row.
- Keep branch creation non-checkout and non-worktree-creating.
- Filter `Checkout To` and `Merge` dialog options:
  - Exclude the target worktree's current branch.
  - Exclude any branch with a linked `worktree.path`.
  - Keep only local branch snapshot entries.
- Support local repositories and SSH-backed remote repositories through existing backend boundaries.

Out of scope:

- Deleting or renaming branches.
- Pushing newly created branches.
- Creating worktrees as part of branch creation.
- Merging during fetch.
- Replacing the existing `Pull` action.
- Broad branch menu redesign.

## Current State

The repository already has a branch action pipeline for checkout, pull, push, create worktree, delete branch, and remove worktree. `pull` runs through `RepoBackend`, so local and SSH-backed remote repositories already share the same scheduling, network lane, cancellation, invalidation, and refresh behavior.

There is also a general repository fetch route and client function: `/api/repo/fetch` and `fetchRepository`. Today that path is used by refresh/sync behavior, not exposed as an explicit branch-row action.

`Create Branch` and `Track Remote Branch` are described in an existing design, but the current code has not wired branch-only creation into `RepoBranchAction` or the branch menu.

The current `Checkout To` and `Merge` dialogs only exclude the selected branch name. They still offer branches that are checked out in other worktrees. Those choices can fail at Git execution time and should be removed from the selector.

## Interaction Design

Branch rows gain a non-destructive `Fetch Remote` menu item. It is visible when the repository has remotes. Selecting it runs fetch for the repository and refreshes the branch snapshot. It does not checkout, merge, fast-forward a worktree, or update worktree files.

The existing `Pull` item remains available for branches with upstream tracking. Its label and behavior should continue to communicate pull semantics separately from fetch.

Branch rows also gain `Create Branch`. The dialog shows the selected row branch as the base and asks for one field: the new local branch name. Submission creates the branch and closes the dialog on success. It does not switch the active worktree or select the new branch except through normal snapshot refresh behavior.

`Checkout To` and `Merge` dialogs should use the same candidate helper. For a selected worktree branch, candidate branches are all local branches without a `worktree.path`, except the selected branch itself. If no candidates remain, the select is empty and the confirm button stays disabled.

## Architecture

### Fetch Remote Action

Use the existing fetch path rather than adding a new Git command:

```ts
fetchRepository(repo.id, 'user', signal, sourceToken)
```

Add a small branch action kind:

```ts
{ kind: 'fetchRemote' }
```

This keeps menu busy state, result events, cancellation, and refresh orchestration consistent with other branch actions. It uses the network lane, like pull and push, but its operation target is `null` because it is repository-scoped.

### Create Branch Action

Add a repository branch action:

```ts
{ kind: 'createBranch'; branch: string; baseBranch: string }
```

System git uses:

```text
git branch -- <branch> <baseBranch>
```

Remote SSH uses a dedicated remote command with the same semantics. The route and backend should delegate through `RepoBackend` rather than constructing local paths in the route layer.

Branch names are validated on the client for quick feedback and on the server as the authoritative guard. Duplicate branch names should be rejected in the dialog based on the current branch snapshot, with Git errors still passed through for races.

### Candidate Filtering

Add one pure helper near branch write dialogs or repo branch view helpers:

```ts
branchWriteCandidates(currentBranch: string, branches: RepoBranchState[]): RepoBranchState[]
```

Rules:

- Return a new array.
- Exclude `branch.name === currentBranch`.
- Exclude any branch with `branch.worktree?.path`.
- Preserve input order.

Both `CheckoutToDialog` and `MergeDialog` use this helper. This keeps the filter behavior DRY and makes it easy to unit test without React.

## Data Flow

### Fetch Remote

1. User selects `Fetch Remote` from a branch row menu.
2. Renderer submits `RepoBranchAction { kind: 'fetchRemote' }`.
3. Store schedules it in the network lane.
4. Client posts to `/api/repo/fetch`.
5. Server resolves local or remote `RepoBackend`.
6. Backend runs fetch/prune only.
7. On success, repository snapshot invalidation and refresh update branch metadata.

### Create Branch

1. User selects `Create Branch` from a branch row menu.
2. Dialog receives selected row branch as `baseBranch`.
3. User enters a local branch name.
4. Dialog validates name and duplicate local branch.
5. Renderer submits `RepoBranchAction { kind: 'createBranch', branch, baseBranch }`.
6. Store schedules it in the write lane.
7. Server resolves local or remote `RepoBackend`.
8. Backend creates the branch.
9. Snapshot refresh updates the branch list.

### Merge Candidate Filtering

1. User opens `Merge`.
2. Dialog computes candidates from the current branch snapshot.
3. Branches already linked to any worktree are excluded.
4. User can only select a safe local branch.
5. Existing merge execution behavior remains unchanged; this spec only changes which branches can be selected.

## Error Handling

Fetch uses existing network operation errors:

- `error.network-op-in-progress` when another user network operation blocks it.
- `cancelled` when aborted.
- Backend Git/SSH stderr for Git failures.

Create branch returns:

- `error.invalid-arguments` for invalid branch or base branch inputs.
- A duplicate-name dialog validation before submit when the current snapshot already contains the branch.
- Raw Git output for race conditions.

Candidate filtering prevents known-invalid checkout and merge choices in the UI. Git execution remains authoritative for race conditions and merge conflicts.

## Testing

Add focused coverage:

- Candidate helper excludes the current branch.
- Candidate helper excludes branches with `worktree.path`.
- Candidate helper preserves eligible branch order.
- `Fetch Remote` menu item is visible only when the repo has remotes.
- `Fetch Remote` dispatches fetch action and shows network busy state.
- Store tests cover `fetchRemote` scheduling, result mapping, and refresh after success.
- Client/server tests confirm the fetch action reuses `/api/repo/fetch`.
- System git tests cover branch creation argument construction and invalid names.
- Remote command tests cover SSH branch creation command construction.
- Create branch dialog validates empty, invalid, and duplicate names.

## Verification

Implementation should pass:

```text
bun run typecheck
bun run test
```

Manual verification:

- Open a repo with a remote.
- Run `Fetch Remote` from a branch menu and confirm remote-tracking refs update without changing the active worktree.
- Create a branch from an existing branch row and confirm the current checkout does not change.
- Open `Checkout To` and `Merge` dialogs in a repo with multiple worktrees and confirm checked-out branches are not selectable.
